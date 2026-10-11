// 八个控制器放在一起，场景表里用 [id, cfg] 点名，createKernel 照这张表建实例：
//   createKernel(session, { scenes, controllers: CONTROLLERS })
import speech from './speech.js';
import handover from './handover.js';
import space from './space.js';
import clock from './clock.js';
import attention from './attention.js';
import standing from './standing.js';
import evidence from './evidence.js';
import lens from './lens.js';

export { speech, handover, space, clock, attention, standing, evidence, lens };

export const CONTROLLERS = { speech, handover, space, clock, attention, standing, evidence, lens };
export default CONTROLLERS;
