import { TAU, clamp, smoothstep } from "./rig.js";

const segment = (t, from, to) => smoothstep((t - from) / (to - from));
const pulse = (t, from, to) => Math.sin(clamp((t - from) / (to - from), 0, 1) * Math.PI);

export const clips = {
  idle: {
    label: "Idle",
    duration: 4.6,
    loop: true,
    pose(t, s) {
      const breath = Math.sin(t * TAU);
      const drift = Math.sin(t * TAU + 1.1);
      return {
        bob: breath * 1.5 * (s.height / 150),
        torso: 0.035 + breath * 0.012,
        head: -0.015 + drift * 0.03,
        footL: { x: -s.hipHalf * 0.65, angle: 0.02 },
        footR: { x: s.hipHalf * 0.8, angle: 0.02 },
        armL: { shoulder: -0.09 + breath * 0.015, elbow: 0.24 + breath * 0.02 },
        armR: { shoulder: 0.1 - breath * 0.015, elbow: 0.2 - breath * 0.015 },
      };
    },
  },

  walk: {
    label: "Walk",
    duration: 0.92,
    loop: true,
    pose(t, s) {
      const phase = t * TAU;
      const stride = s.legLength * 0.32;
      const lift = s.legLength * 0.14;
      const cos = Math.cos(phase);
      const step = (offset) => {
        const p = phase + offset;
        return {
          x: Math.cos(p) * stride,
          y: Math.max(0, -Math.sin(p)) * lift,
          angle: -0.3 * Math.cos(p),
        };
      };
      return {
        bob: (1 - Math.cos(phase * 2)) * 0.5 * s.height * 0.011,
        torso: 0.075 + 0.02 * Math.cos(phase * 2),
        head: -0.045 - 0.012 * Math.cos(phase * 2),
        footL: step(0),
        footR: step(Math.PI),
        armL: {
          shoulder: -cos * 0.55 - 0.02,
          elbow: 0.3 + Math.max(0, -cos) * 0.28,
        },
        armR: {
          shoulder: cos * 0.55 - 0.02,
          elbow: 0.3 + Math.max(0, cos) * 0.28,
        },
      };
    },
  },

  run: {
    label: "Run",
    duration: 0.6,
    loop: true,
    pose(t, s) {
      const phase = t * TAU;
      const stride = s.legLength * 0.46;
      const lift = s.legLength * 0.3;
      const cos = Math.cos(phase);
      const step = (offset) => {
        const p = phase + offset;
        return {
          x: Math.cos(p) * stride,
          y: Math.max(0, -Math.sin(p)) * lift,
          angle: -0.45 * Math.cos(p),
        };
      };
      return {
        bob: (1 - Math.cos(phase * 2)) * 0.5 * s.height * 0.028,
        torso: 0.24 + 0.035 * Math.cos(phase * 2),
        head: -0.1,
        footL: step(0),
        footR: step(Math.PI),
        armL: {
          shoulder: -cos * 1.05 - 0.1,
          elbow: 1.25 + Math.max(0, -cos) * 0.35,
        },
        armR: {
          shoulder: cos * 1.05 - 0.1,
          elbow: 1.25 + Math.max(0, cos) * 0.35,
        },
      };
    },
  },

  jump: {
    label: "Jump",
    duration: 1.2,
    loop: false,
    pose(t, s) {
      const wind = pulse(t, 0, 0.26);
      const air = Math.sin(clamp((t - 0.2) / 0.6, 0, 1) * Math.PI);
      const land = pulse(t, 0.8, 1);
      const tuck = pulse(t, 0.28, 0.75);
      const lift = air * s.height * 0.36;
      const feetLift = tuck * s.legLength * 0.24;
      return {
        bob: -s.height * 0.11 * wind - s.height * 0.08 * land,
        lift,
        torso: 0.05 + 0.3 * wind + 0.14 * land - 0.07 * air,
        head: -0.08 * air + 0.1 * land,
        footL: { x: -s.hipHalf * 0.9, y: feetLift, angle: 0.24 * tuck },
        footR: { x: s.hipHalf * 1.0, y: feetLift * 0.85, angle: 0.2 * tuck },
        armL: {
          shoulder: -0.1 - 0.9 * wind + 2.25 * air,
          elbow: 0.22 + 0.55 * wind + 0.2 * air + 0.5 * land,
        },
        armR: {
          shoulder: 0.1 - 0.8 * wind + 2.4 * air,
          elbow: 0.2 + 0.5 * wind + 0.15 * air + 0.55 * land,
        },
      };
    },
  },

  wave: {
    label: "Wave",
    duration: 2.6,
    loop: true,
    pose(t, s) {
      const wave = Math.sin(t * TAU * 3.2);
      return {
        bob: Math.sin(t * TAU) * 1.2,
        torso: 0.03 + Math.sin(t * TAU) * 0.018,
        head: -0.07 + Math.sin(t * TAU + 0.8) * 0.02,
        footL: { x: -s.hipHalf * 0.7 },
        footR: { x: s.hipHalf * 0.85 },
        armL: { shoulder: -0.12, elbow: 0.26 },
        armR: { shoulder: 2.45 + wave * 0.16, elbow: 0.15 - wave * 0.08 },
      };
    },
  },

  point: {
    label: "Point",
    duration: 2.2,
    loop: true,
    pose(t, s) {
      const pulse = Math.sin(t * TAU);
      return {
        bob: pulse * 0.8,
        torso: 0.055 + pulse * 0.012,
        head: 0.015,
        footL: { x: -s.hipHalf * 0.5 },
        footR: { x: s.hipHalf * 1.1 },
        armL: { shoulder: -0.28, elbow: 0.4 },
        armR: { shoulder: 1.42 + pulse * 0.03, elbow: 0.03 },
      };
    },
  },

  talk: {
    label: "Talk",
    duration: 3.4,
    loop: true,
    pose(t, s) {
      const phase = t * TAU;
      return {
        bob: Math.sin(phase * 2) * 1.1,
        torso: 0.035 + Math.sin(phase) * 0.025,
        head: 0.02 + Math.sin(phase * 3 + 1) * 0.045,
        footL: { x: -s.hipHalf * 0.7 },
        footR: { x: s.hipHalf * 0.8 },
        armL: {
          shoulder: 0.42 + Math.sin(phase + 2.4) * 0.2,
          elbow: 1.25 + Math.cos(phase + 2.4) * 0.18,
        },
        armR: {
          shoulder: 0.58 + Math.sin(phase) * 0.25,
          elbow: 1.15 + Math.cos(phase) * 0.22,
        },
      };
    },
  },

  salute: {
    label: "Salute",
    duration: 2.2,
    loop: false,
    pose(t, s) {
      const raise = segment(t, 0, 0.3);
      const drop = segment(t, 0.82, 1);
      const headY = -(s.hipHeight + s.torsoLength + s.neckLength + s.headRadius * 0.95);
      const target = {
        x: s.headRadius * 0.8,
        y: headY + s.headRadius * 0.15,
      };
      return {
        bob: raise * 1.2,
        torso: 0.02 - raise * 0.02,
        head: -0.03 * raise,
        footL: { x: -s.hipHalf * 0.5 },
        footR: { x: s.hipHalf * 0.55 },
        armL: { shoulder: -0.18, elbow: 0.28 },
        armR: { shoulder: 1.6 + 0.5 * raise, elbow: 0.25 + 0.35 * raise },
        handR: raise > 0.01 && drop < 0.99 ? target : null,
      };
    },
  },

  reach: {
    label: "Reach",
    duration: 1.4,
    loop: false,
    pose(t, s) {
      const stretch = segment(t, 0, 0.45);
      const push = pulse(t, 0.5, 0.95);
      return {
        bob: -s.height * 0.012 * stretch,
        torso: 0.15 * stretch,
        head: 0.04 * stretch,
        footL: { x: -s.hipHalf * 0.9 },
        footR: { x: s.hipHalf * 1.4, angle: 0.1 },
        armL: { shoulder: -0.38 - stretch * 0.25, elbow: 0.35 },
        armR: { shoulder: 0.12 + 1.32 * stretch + 0.06 * push, elbow: 0.2 - 0.16 * stretch },
      };
    },
  },

  crouch: {
    label: "Crouch",
    duration: 3.0,
    loop: true,
    pose(t, s) {
      const breath = Math.sin(t * TAU);
      return {
        bob: -s.height * 0.14 + breath * 1.2,
        torso: 0.35 + breath * 0.012,
        head: -0.12,
        footL: { x: -s.height * 0.072, angle: -0.04 },
        footR: { x: s.height * 0.072, angle: -0.04 },
        armL: { shoulder: 0.5, elbow: 1.15 + breath * 0.04 },
        armR: { shoulder: 0.62, elbow: 1.08 - breath * 0.04 },
      };
    },
  },

  cry: {
    label: "Cry",
    duration: 2.8,
    loop: true,
    pose(t, s) {
      const shake = Math.sin(t * TAU * 7) * 0.02;
      const torso = 0.3 + shake;
      const head = 0.35 + shake * 1.4;
      const headY = -(
        s.hipHeight
        - s.height * 0.06
        + Math.cos(torso) * (s.torsoLength + s.neckLength)
        + Math.cos(torso + head) * s.headRadius * 0.95
      );
      const headX = Math.sin(torso) * (s.torsoLength + s.neckLength)
        + Math.sin(torso + head) * s.headRadius * 0.95;
      return {
        bob: -s.height * 0.055,
        torso,
        head,
        footL: { x: -s.hipHalf * 0.45 },
        footR: { x: s.hipHalf * 0.55 },
        armL: { shoulder: 0.3, elbow: 0.4 },
        armR: { shoulder: 0.3, elbow: 0.4 },
        handL: { x: headX - s.headRadius * 0.25, y: headY + s.headRadius * 0.3 },
        handR: { x: headX + s.headRadius * 0.45, y: headY + s.headRadius * 0.22 },
      };
    },
  },

  fall: {
    label: "Fall",
    duration: 1.8,
    loop: false,
    pose(t, s) {
      const fall = segment(t, 0.08, 0.62);
      const bounce = pulse(t, 0.62, 0.88);
      return {
        bob: bounce * s.height * 0.02,
        lift: s.height * 0.03 * fall,
        lean: -1.45 * fall,
        torso: 0.04 - 0.12 * fall,
        head: 0.26 * fall,
        footL: { x: -s.hipHalf * 0.75, angle: -0.12 * fall },
        footR: { x: s.hipHalf * 0.9, angle: -0.16 * fall },
        armL: {
          shoulder: 2.3 * fall,
          elbow: 0.2 + 0.45 * fall,
        },
        armR: {
          shoulder: -1.7 * fall,
          elbow: 0.2 + 0.3 * fall,
        },
      };
    },
  },
};

export const clipList = Object.entries(clips).map(([id, clip]) => ({ id, ...clip }));

export const clipGroups = ["Циклы", "Действия", "Состояния"];

export const clipGroupById = {
  idle: "Циклы",
  walk: "Циклы",
  run: "Циклы",
  crouch: "Циклы",
  cry: "Циклы",
  jump: "Действия",
  wave: "Действия",
  point: "Действия",
  talk: "Действия",
  salute: "Действия",
  reach: "Действия",
  fall: "Состояния",
};
