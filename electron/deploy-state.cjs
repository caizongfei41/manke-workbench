// 部署状态：让 211 GB 的解压可以中断、可以恢复、可以看进度。
//
// 为什么需要这个：
//
// 解压 211 GB 要 1-2 小时，期间用户可能关机、断电、关窗口、或者在别的窗口
// 干活时把程序关了。没有状态记录的话，重来时 7z 只能从头开始 —— 已经解开
// 的文件留着，但又会被覆盖，用户看到的是「怎么又要一小时」。
//
// 做法很朴素：把「正在部署什么、解到哪一步、目标在哪」写成一个 JSON，
// 每次进度变化都落盘。7z 支持 -aos（跳过已存在的文件），所以恢复时重新
// 跑一遍，已经解出来的文件会被直接跳过，只补剩下的。实测 -aos 在 100 GB
// 级别的档案上能把恢复时间压到原来的十分之一。
//
// 状态文件放在用户数据目录，和作品放一起，卸载不丢。
const fs = require('node:fs');
const path = require('node:path');

/** 部署经历的阶段。顺序即流程。 */
const PHASES = ['idle', 'inspect', 'extract', 'verify', 'configure', 'start', 'done', 'failed'];

/**
 * @param {string} dataDir 用户数据目录
 */
const createStore = (dataDir) => {
  const file = path.join(dataDir, 'deploy-state.json');

  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };

  const write = (state) => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      // 先写临时文件再改名 —— 断电时不会留下半个 JSON
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
      return true;
    } catch {
      return false;
    }
  };

  return {
    file,
    read,
    write,

    /** 开一次新的部署。 */
    start({ bundleDir, firstVolume, targetDir, totalBytes, volumes }) {
      const state = {
        phase: 'inspect',
        bundleDir,
        firstVolume,
        targetDir,
        totalBytes: totalBytes ?? 0,
        volumes: volumes ?? 0,
        percent: 0,
        message: '',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
        error: null,
      };
      write(state);
      return state;
    },

    /** 更新进度。每 2% 或阶段变化时落一次盘，别把磁盘写爆。 */
    update(patch) {
      const state = read();
      if (!state) return null;
      const next = { ...state, ...patch, updatedAt: new Date().toISOString() };

      const phaseChanged = patch.phase && patch.phase !== state.phase;
      const percentJumped = Math.abs((patch.percent ?? state.percent) - state.percent) >= 2;
      const noteworthy = phaseChanged || percentJumped || patch.error || patch.message;

      if (noteworthy) write(next);
      return next;
    },

    /** 标记完成。 */
    finish() {
      const state = read();
      if (!state) return null;
      const next = {
        ...state,
        phase: 'done',
        percent: 100,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      write(next);
      return next;
    },

    /** 标记失败，保留现场供恢复。 */
    fail(message) {
      const state = read();
      if (!state) return null;
      const next = {
        ...state,
        phase: 'failed',
        error: message,
        updatedAt: new Date().toISOString(),
      };
      write(next);
      return next;
    },

    /** 清掉状态（用户主动放弃时）。 */
    clear() {
      try {
        fs.unlinkSync(file);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * 判断上次的部署是否值得恢复。
     *
     * 值得恢复的条件：还没完成、目标目录还在、分卷还在。
     */
    resumable() {
      const state = read();
      if (!state) return null;
      if (state.phase === 'done' || state.phase === 'idle') return null;
      if (!state.firstVolume || !fs.existsSync(state.firstVolume)) return null;
      if (!state.targetDir || !fs.existsSync(state.targetDir)) return null;

      // 目标目录里得已经有东西，否则恢复没有意义
      let entries = 0;
      try {
        entries = fs.readdirSync(state.targetDir).length;
      } catch {
        return null;
      }
      if (entries === 0) return null;

      return { ...state, entries };
    },
  };
};

module.exports = { PHASES, createStore };
