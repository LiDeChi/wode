// 读镜（docs/design/LIVING.md §5、§9）。
//
// 只读：拿现在的心智、记忆装置、导演案、导师笔记、因果片段，拼成一份「现在能看见什么」。
// 绝不写：不调会登记的 watch，不调会写账的 ask，不碰原心智的 tick/perceive/hear。
//
// 每个片段都是结构化的：来源（source）、层级（layer）、对象（object）、原因 id（reasonId）、
// 账本位置（seq）、以及一条开发可读的字段路径（path）。
// 说成人话在最后一步，走 say()——今天是一层模板，以后换成 LLM 措辞也不影响任何结果。

const asMap = (x) => (x && typeof x === 'object' ? x : {});

/** 可替换的翻译层：结构化片段 → 人话。只读，不参与任何判定。 */
export function say(rec = {}) {
  const who = rec.person ?? '他';
  const what = rec.object ?? rec.signature ?? '这件事';
  const layer = rec.layer === 'mind' ? '心里' : rec.layer === 'module' ? '老习惯' : '手已经动了';
  if (rec.source === 'memory') return `${who}还记着「${what}」，现在有 ${rec.activation ?? 0} 成亮。`;
  if (rec.source === 'note') return `${who}把这句留在了纸上：${what}`;
  if (rec.source === 'plan') return `${who}这一拍打算${what}。`;
  return `${who}的${layer}停在了「${what}」${rec.reasonId ? `（原因 ${rec.reasonId}）` : ''}。`;
}

const frag = (o) => ({ ...o, say: say(o) });

/**
 * createLifeView({ session, kernel, life })
 *   read(sceneId)  现在这一场看得见的东西（结构化）
 *   trace(seq)     当时真实留下的感知片段（感知那一刻存的，不是现在倒算的）
 *   say(rec)       翻译层（同一份，方便调用方覆盖）
 */
export function createLifeView({ session, kernel, life } = {}) {
  const sceneOf = kernel?.sceneOf;
  const worldOf = kernel?.peekWorld || (() => null);
  const minds = asMap(session?.minds);
  const ledger = session?.ledger;

  function memoryOf(person) {
    const st = minds[person]?.state || {};
    return Object.entries(asMap(st.memory)).map(([signature, m]) => frag({
      source: 'memory',
      layer: 'mind',
      person,
      object: signature,
      signature,
      reasonId: m?.claimId ?? null,
      seq: m?.seq ?? null,
      at: m?.at ?? null,
      trace: m?.trace ?? 0,
      activation: m?.activation ?? 0,
      consolidation: m?.consolidation ?? 0,
      path: `minds.${person}.state.memory[${signature}].activation`,
    })).sort((a, b) => b.activation - a.activation || (a.signature < b.signature ? -1 : 1));
  }

  function lastOf(person) {
    const st = minds[person]?.state || {};
    const last = (st.log || [])[st.log.length - 1];
    if (!last) return null;
    return frag({
      source: 'perception',
      layer: last.stoppedAt === 'mind' ? 'mind' : last.stoppedAt === 'module' ? 'module' : 'unit',
      person,
      object: last.action?.act ?? last.signature ?? null,
      signature: last.signature ?? null,
      reasonId: last.reasonId ?? null,
      seq: last.seq ?? null,
      at: last.at ?? null,
      stoppedAt: last.stoppedAt ?? null,
      action: last.action?.act ?? null,
      path: `minds.${person}.state.log[${(st.log || []).length - 1}]`,
    });
  }

  function read(sceneId) {
    const world = worldOf(sceneId);
    const scene = sceneOf ? sceneOf(sceneId) : null;
    const people = Array.isArray(scene?.people) ? scene.people.slice() : Object.keys(minds);
    const beat = scene?.beat ?? sceneId;
    const work = scene?.work ?? null;
    const design = asMap(session?.state?.designs)[work] || null;
    const b = design?.beats?.find?.((x) => x.id === beat) || null;
    const policy = b?.lifePolicy || life?.policy?.(sceneId) || null;
    const ls = life?.state?.() || {};

    const actors = people.filter((id) => minds[id]).map((id) => {
      const mind = minds[id];
      const st = mind.state || {};
      const l = lastOf(id);
      return {
        id,
        name: mind.name ?? id,
        at: st.at ?? world?.ctrl?.space?.[id]?.at ?? null,
        trust: st.trust?.['门客（你）'] ?? st.trust?.user ?? null,
        stress: st.stress ?? null,
        goal: st.goal ?? mind.def?.goals?.[0] ?? null,
        installed: (st.installed || []).slice(),
        memory: memoryOf(id).slice(0, 4),
        last: l,
        thinking: [l, ...memoryOf(id).slice(0, 3)].filter(Boolean),
      };
    });

    const causes = (ledger?.entries || []).slice(-12).map((e) => ({
      seq: e.seq,
      kind: e.kind,
      from: e.from,
      to: e.to,
      cause: (e.cause || []).slice(),
      said: e.said ?? null,
      path: `ledger[${e.seq - 1}]`,
    }));

    const experiences = (life?.recall?.({ limit: 6 }) || []).map((m) => frag({
      source: 'memory',
      layer: 'mind',
      person: m.person,
      object: m.key,
      reasonId: m.note ?? null,
      seq: m.seq,
      at: m.tick,
      activation: m.activation,
      consolidation: m.consolidation,
      path: `life.store[${m.id}]`,
    }));

    const dir = session?.state?.directorId ? session?.directors?.[session.state.directorId] : null;
    const mentorState = session?.mentor?.state?.() || null;

    return {
      scene: sceneId,
      beat,
      work,
      tick: ls.tick ?? null,
      place: scene?.place ?? null,
      title: scene?.title ?? null,
      policy: policy && {
        waitForPlayer: policy.waitForPlayer,
        cadenceTicks: policy.cadenceTicks,
        autonomy: policy.autonomy,
        warning: policy.warning,
        historyReveal: policy.historyReveal,
        why: policy.why,
        sourceSeq: policy.sourceSeq ?? null,
        path: `designs.${work}.beats[${beat}].lifePolicy`,
      },
      actors,
      director: dir ? {
        id: dir.id ?? session.state.directorId,
        name: dir.def?.name ?? dir.id ?? null,
        why: policy?.why ?? null,
        sourceSeq: policy?.sourceSeq ?? null,
        path: `directors.${session.state.directorId}`,
      } : null,
      mentor: mentorState ? {
        notes: mentorState.notes,
        pause: mentorState.notes?.pause ?? null,
        path: 'mentor.state().notes',
      } : null,
      causes,
      experiences,
      watching: {
        watched: (world?.watched || []).slice(),
        asked: (world?.asked || []).slice(),
        noticed: Object.keys(asMap(world?.noticed)),
        path: `play.kernel.worlds.${sceneId}`,
      },
    };
  }

  /** 当时留下的真实片段：感知那一刻存的，不是用现在的记忆倒算的 */
  function trace(seq) {
    const rec = life?.perception?.(seq) || null;
    if (!rec) return null;
    return {
      seq,
      tick: rec.tick ?? null,
      scene: rec.scene ?? null,
      person: rec.person ?? null,
      signature: rec.signature ?? null,
      stoppedAt: rec.stoppedAt ?? null,
      action: rec.action ?? null,
      moved: rec.moved ?? null,
      reason: rec.reason ?? null,
      trace: rec.trace ?? null,
      layer: rec.stoppedAt === 'mind' ? 'mind' : rec.stoppedAt === 'module' ? 'module' : 'unit',
      object: rec.action ?? rec.signature ?? null,
      reasonId: rec.reasonId ?? null,
      path: `play.life.perceptions[${seq}]`,
    };
  }

  return { read, trace, say };
}
