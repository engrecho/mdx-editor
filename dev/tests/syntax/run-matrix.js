/**
 * 页面里跑的矩阵逻辑。单独放文件，避免模板字符串转义问题。
 *
 * 判定：
 *   err        —— 操作抛异常
 *   missingHead—— 行首标记丢了（块结构被破坏）
 *   missingCnt —— 内容关键词丢了（内容被吃掉或劈开）
 *   split      —— 锚点词不再连续（段落被劈成两半）
 */
(function (CONTEXTS, COMMANDS, INTEGRITY, ANCHORS) {
  const Q = window.__qingmo, V = window.__view;
  const out = [];

  for (const ctx of CONTEXTS) {
    const integ = INTEGRITY[ctx.id] || { head: [], content: [] };
    const anchor = ANCHORS[ctx.id] || '';

    for (const cmd of COMMANDS) {
      let doc = '', err = '';
      try {
        Q.setDoc(ctx.doc, ctx.cursor);
        Q.run(cmd);
        doc = Q.getDoc();
      } catch (e) {
        err = (e && e.message) || String(e);
      }

      const missingHead = (integ.head || []).filter(f => !doc.includes(f));
      const missingCnt = (integ.content || []).filter(f => !doc.includes(f));

      // 段落被劈开：锚点词在结果里应该还是连续的
      // 用「出现次数不变」判定 —— 被劈成两半会变成两次出现
      let split = false;
      if (anchor) {
        const orig = ctx.doc.split(anchor).length - 1;
        const now = doc.split(anchor).length - 1;
        split = now < orig;
      }

      out.push({
        ctx: ctx.id, ctxName: ctx.name, cmd,
        doc, err,
        missingHead, missingCnt, split,
        anchor
      });
    }
  }
  return out;
});
