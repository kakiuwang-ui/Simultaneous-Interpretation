// LocalAgreement-2 提交策略
// -----------------------------------------------------------
// 流式 ASR 会不断刷新"临时假设"(interim hypothesis)。
// 直接显示临时结果会让字幕疯狂跳动;直接等到整句结束又太慢。
// LocalAgreement-2 的思想:只有当【连续两次】的假设在某个前缀词上
// 达成一致时,才把这些词"定稿"(commit),其余留作可变的临时区。
//
// 这样既能尽快出字,又能避免把还会变的词写死,是 whisper_streaming 等
// 流式同传系统采用的经典做法。

export class LocalAgreement {
  constructor() {
    this.committed = [];      // 已定稿的词数组
    this.prevHypothesis = []; // 上一轮的(完整)假设词数组
  }

  // 输入本轮 ASR 的完整假设词数组,返回 { committed, pending }
  //   committed: 截至目前已定稿的全部词
  //   pending:   尚未定稿、仍可能变化的词(界面上用灰色显示)
  update(words) {
    const newlyCommitted = [];
    // 从"已定稿长度"之后开始,逐词比较本轮与上一轮假设
    const start = this.committed.length;
    let i = start;
    while (
      i < words.length &&
      i < this.prevHypothesis.length &&
      normalize(words[i]) === normalize(this.prevHypothesis[i])
    ) {
      newlyCommitted.push(words[i]);
      i++;
    }
    this.committed.push(...newlyCommitted);
    this.prevHypothesis = words;

    const pending = words.slice(this.committed.length);
    return {
      committed: this.committed.slice(),
      pending,
      newlyCommitted,
    };
  }

  // 句子边界(ASR 给出 final / 检测到长停顿)时,强制把剩余假设全部定稿
  flush(words) {
    const finalWords = words && words.length ? words : this.prevHypothesis;
    const newlyCommitted = finalWords.slice(this.committed.length);
    this.committed = finalWords.slice();
    this.prevHypothesis = finalWords.slice();
    return { committed: this.committed.slice(), pending: [], newlyCommitted };
  }

  reset() {
    this.committed = [];
    this.prevHypothesis = [];
  }
}

function normalize(w) {
  return String(w).toLowerCase().replace(/[.,!?;:'"]/g, '');
}
