import { TAU, clamp, smoothstep } from "./rig.js?v=12";

const segment = (t, from, to) => smoothstep((t - from) / (to - from));
const pulse = (t, from, to) => Math.sin(clamp((t - from) / (to - from), 0, 1) * Math.PI);

export const clips = {
  idle: {
    label: "Idle",
    group: "Loops",
    duration: 4.6,
    loop: true,
    pose(t, s) {
      const breath = Math.sin(t * TAU);
      const drift = Math.sin(t * TAU + 1.1);
      return {
        bob: breath * 1.4 * (s.height / 150),
        torso: 0.03 + breath * 0.012,
        head: -0.01 + drift * 0.03,
        footL: { x: -s.height * 0.09, angle: 0.02 },
        footR: { x: s.height * 0.095, angle: 0.02 },
        armL: { shoulder: -0.08 + breath * 0.02, elbow: 0.2 + breath * 0.02 },
        armR: { shoulder: 0.09 - breath * 0.02, elbow: 0.18 - breath * 0.015 },
      };
    },
  },

  walk: {
    label: "Walk",
    group: "Loops",
    duration: 0.92,
    loop: true,
    pose(t, s) {
      const phase = t * TAU;
      const stride = s.legLength * 0.3;
      const lift = s.legLength * 0.13;
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
        torso: 0.07 + 0.02 * Math.cos(phase * 2),
        head: -0.04 - 0.012 * Math.cos(phase * 2),
        footL: step(0),
        footR: step(Math.PI),
        armL: { shoulder: -cos * 0.62 - 0.02, elbow: 0.26 + Math.max(0, -cos) * 0.3 },
        armR: { shoulder: cos * 0.62 - 0.02, elbow: 0.26 + Math.max(0, cos) * 0.3 },
      };
    },
  },

  run: {
    label: "Run",
    group: "Loops",
    duration: 0.58,
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
          angle: -0.42 * Math.cos(p),
        };
      };
      return {
        bob: (1 - Math.cos(phase * 2)) * 0.5 * s.height * 0.03,
        torso: 0.24 + 0.04 * Math.cos(phase * 2),
        head: -0.09,
        footL: step(0),
        footR: step(Math.PI),
        armL: { shoulder: -cos * 1.05 - 0.12, elbow: 1.2 + Math.max(0, -cos) * 0.35 },
        armR: { shoulder: cos * 1.05 - 0.12, elbow: 1.2 + Math.max(0, cos) * 0.35 },
      };
    },
  },

  crouch: {
    label: "Crouch",
    group: "Loops",
    duration: 2.6,
    loop: true,
    pose(t, s) {
      const breath = Math.sin(t * TAU);
      return {
        bob: -s.height * 0.16 + breath * 1.1,
        torso: 0.34 + breath * 0.014,
        head: -0.14,
        footL: { x: -s.height * 0.075, angle: -0.05 },
        footR: { x: s.height * 0.075, angle: -0.05 },
        armL: { shoulder: 0.5, elbow: 1.2 + breath * 0.04 },
        armR: { shoulder: 0.62, elbow: 1.12 - breath * 0.04 },
      };
    },
  },

  dance: {
    label: "Dance",
    group: "Loops",
    duration: 1.6,
    loop: true,
    pose(t, s) {
      const phase = t * TAU;
      const beat = Math.sin(phase * 2);
      const step = Math.sin(phase);
      return {
        rootX: step * s.height * 0.016,
        bob: (1 - Math.cos(phase * 4)) * 0.5 * s.height * 0.016 - s.height * 0.012,
        torso: 0.05 + beat * 0.07,
        head: -beat * 0.05 + Math.sin(phase * 4) * 0.02,
        footL: { x: -s.hipHalf * 1.1 + step * s.legLength * 0.1, y: Math.max(0, step) * s.legLength * 0.08, angle: -0.1 },
        footR: { x: s.hipHalf * 1.1 + step * s.legLength * 0.1, y: Math.max(0, -step) * s.legLength * 0.08, angle: -0.1 },
        armL: { shoulder: 1.2 + beat * 1.15, elbow: 0.55 - beat * 0.2 },
        armR: { shoulder: 1.15 - beat * 1.1, elbow: 0.6 + beat * 0.2 },
      };
    },
  },

  jump: {
    label: "Jump",
    group: "Actions",
    duration: 1.2,
    loop: false,
    pose(t, s) {
      const wind = pulse(t, 0, 0.26);
      const air = Math.sin(clamp((t - 0.2) / 0.6, 0, 1) * Math.PI);
      const land = pulse(t, 0.8, 1);
      const tuck = pulse(t, 0.28, 0.75);
      return {
        bob: -s.height * 0.11 * wind - s.height * 0.08 * land,
        lift: air * s.height * 0.32,
        torso: 0.05 + 0.28 * wind + 0.14 * land - 0.07 * air,
        head: -0.08 * air + 0.1 * land,
        footL: { x: -s.height * 0.065, y: tuck * s.legLength * 0.24, angle: 0.24 * tuck },
        footR: { x: s.height * 0.075, y: tuck * s.legLength * 0.21, angle: 0.2 * tuck },
        armL: {
          shoulder: -0.1 - 0.9 * wind + 2.2 * air,
          elbow: 0.2 + 0.55 * wind + 0.2 * air + 0.5 * land,
        },
        armR: {
          shoulder: 0.1 - 0.85 * wind + 2.35 * air,
          elbow: 0.18 + 0.5 * wind + 0.15 * air + 0.55 * land,
        },
      };
    },
  },

  wave: {
    label: "Wave",
    group: "Actions",
    duration: 2.4,
    loop: true,
    pose(t, s) {
      const wave = Math.sin(t * TAU * 3.2);
      return {
        bob: Math.sin(t * TAU) * 1.2,
        torso: 0.03 + Math.sin(t * TAU) * 0.018,
        head: -0.06 + Math.sin(t * TAU + 0.8) * 0.02,
        footL: { x: -s.hipHalf * 0.75 },
        footR: { x: s.hipHalf * 0.9 },
        armL: { shoulder: -0.12, elbow: 0.24 },
        armR: { shoulder: 2.4 + wave * 0.18, elbow: 0.2 - wave * 0.1 },
      };
    },
  },

  point: {
    label: "Point",
    group: "Actions",
    duration: 2.2,
    loop: true,
    pose(t, s) {
      const pulse = Math.sin(t * TAU);
      return {
        bob: pulse * 0.8,
        torso: 0.05 + pulse * 0.012,
        head: 0.02,
        footL: { x: -s.hipHalf * 0.55 },
        footR: { x: s.hipHalf * 1.15 },
        armL: { shoulder: -0.26, elbow: 0.38 },
        armR: { shoulder: 1.45 + pulse * 0.04, elbow: 0.02 },
      };
    },
  },

  talk: {
    label: "Talk",
    group: "Actions",
    duration: 3.4,
    loop: true,
    pose(t, s) {
      const phase = t * TAU;
      return {
        bob: Math.sin(phase * 2) * 1.1,
        torso: 0.03 + Math.sin(phase) * 0.025,
        head: 0.02 + Math.sin(phase * 3 + 1) * 0.05,
        footL: { x: -s.hipHalf * 0.75 },
        footR: { x: s.hipHalf * 0.85 },
        armL: {
          shoulder: 0.45 + Math.sin(phase + 2.4) * 0.22,
          elbow: 1.3 + Math.cos(phase + 2.4) * 0.2,
        },
        armR: {
          shoulder: 0.62 + Math.sin(phase) * 0.26,
          elbow: 1.2 + Math.cos(phase) * 0.22,
        },
      };
    },
  },

  salute: {
    label: "Salute",
    group: "Actions",
    duration: 2.2,
    loop: false,
    pose(t, s) {
      const raise = segment(t, 0, 0.26);
      const lower = segment(t, 0.78, 1);
      const hold = raise * (1 - lower);
      const headY = -(s.hipHeight + s.torsoLength + s.neckLength + s.headRadius * 0.95);
      const browX = s.headRadius * 1.3;
      const browY = headY - s.headRadius * 0.26;
      const restX = s.headRadius * 1.2;
      const restY = -s.hipHeight + s.torsoLength * 0.22;
      return {
        bob: hold * 1.1,
        torso: 0.03 - hold * 0.025,
        head: -0.01 - hold * 0.045,
        shoulderLift: hold * 0.5,
        footL: { x: -s.hipHalf * 1.35 },
        footR: { x: s.hipHalf * 1.25 },
        armL: { shoulder: -0.16 - hold * 0.04, elbow: 0.26 },
        armR: { shoulder: 0.09 + 1.05 * hold, elbow: 0.16 + 0.32 * hold },
        handR: {
          x: browX + (restX - browX) * lower,
          y: browY + (restY - browY) * lower,
        },
        handWeightR: raise,
      };
    },
  },

  reach: {
    label: "Reach",
    group: "Actions",
    duration: 1.6,
    loop: false,
    pose(t, s) {
      const stretch = segment(t, 0, 0.45);
      const push = pulse(t, 0.5, 0.95);
      return {
        bob: -s.height * 0.012 * stretch,
        torso: 0.16 * stretch,
        head: 0.05 * stretch,
        footL: { x: -s.hipHalf * 0.9 },
        footR: { x: s.hipHalf * 1.4, angle: 0.1 },
        armL: { shoulder: -0.36 - stretch * 0.25, elbow: 0.32 },
        armR: { shoulder: 0.12 + 1.32 * stretch + 0.06 * push, elbow: 0.2 - 0.16 * stretch },
      };
    },
  },

  think: {
    label: "Think",
    group: "Actions",
    duration: 3.2,
    loop: true,
    pose(t, s) {
      const phase = t * TAU;
      const tap = Math.max(0, Math.sin(phase * 4)) * s.legLength * 0.02;
      const sway = Math.sin(phase);
      return {
        bob: -s.height * 0.01 + sway * 0.35,
        torso: 0.1 + sway * 0.008,
        head: 0.13 + Math.sin(phase * 2 + 0.6) * 0.025,
        footL: { x: -s.height * 0.088, angle: 0.02 },
        footR: { x: s.height * 0.095, y: tap, angle: -0.12 - tap * 0.01 },
        armL: { shoulder: -0.06, elbow: 0.28 + sway * 0.03 },
        armR: { shoulder: 1.34, elbow: 2.45 + sway * 0.035 },
      };
    },
  },

  shrug: {
    label: "Shrug",
    group: "Actions",
    duration: 2.6,
    loop: true,
    pose(t, s) {
      const phase = t * TAU;
      const lift = Math.sin(phase);
      const tilt = Math.sin(phase + 0.8);
      return {
        rootX: Math.sin(phase + 0.4) * s.height * 0.004,
        bob: -s.height * 0.01 + lift * 0.7,
        torso: -0.01 + lift * 0.012,
        head: 0.07 + tilt * 0.05,
        shoulderLift: 0.9 + lift * 0.12,
        footL: { x: -s.hipHalf * 2.6, angle: 0.03 },
        footR: { x: s.hipHalf * 2.1, angle: 0.03 },
        armL: { shoulder: 0.12 + lift * 0.03, elbow: -1.75 - lift * 0.06 },
        armR: { shoulder: 0.22 + lift * 0.03, elbow: 1.78 + lift * 0.06 },
      };
    },
  },

  nod: {
    label: "Nod",
    group: "Emotions",
    duration: 1.6,
    loop: false,
    pose(t, s) {
      const nod = pulse(t, 0.1, 0.48) + pulse(t, 0.5, 0.88) * 0.7;
      return {
        torso: 0.03,
        head: -0.02 + nod * 0.24,
        footL: { x: -s.height * 0.09 },
        footR: { x: s.height * 0.095 },
      };
    },
  },

  sigh: {
    label: "Sigh",
    group: "Emotions",
    duration: 2.8,
    loop: false,
    pose(t, s) {
      const inhale = pulse(t, 0.04, 0.48);
      const exhale = pulse(t, 0.4, 1);
      return {
        bob: s.height * (0.008 * inhale - 0.018 * exhale),
        shoulderLift: 0.5 * inhale - 0.4 * exhale,
        torso: 0.03 + 0.12 * exhale,
        head: -0.06 * inhale + 0.18 * exhale,
        footL: { x: -s.height * 0.09 },
        footR: { x: s.height * 0.095 },
        armL: { shoulder: -0.12 - 0.08 * exhale, elbow: 0.18 },
        armR: { shoulder: 0.12 + 0.08 * exhale, elbow: 0.18 },
      };
    },
  },

  laugh: {
    label: "Laugh",
    group: "Emotions",
    duration: 2.4,
    loop: true,
    pose(t, s) {
      const chuckle = (1 - Math.cos(t * TAU * 4)) * 0.5;
      return {
        bob: -s.height * 0.012 - chuckle * s.height * 0.009,
        torso: 0.16 + chuckle * 0.035,
        head: -0.12 - chuckle * 0.035,
        shoulderLift: chuckle * 0.22,
        footL: { x: -s.height * 0.1 },
        footR: { x: s.height * 0.105 },
        armL: { shoulder: -0.1, elbow: 0.3 },
        armR: { shoulder: -0.35, elbow: 1.75 + chuckle * 0.04 },
      };
    },
  },

  angry: {
    label: "Angry",
    group: "Emotions",
    duration: 2,
    loop: true,
    pose(t, s) {
      const shake = Math.sin(t * TAU * 3);
      return {
        bob: -s.height * 0.02,
        torso: 0.14 + shake * 0.008,
        head: 0.1,
        shoulderLift: 0.35,
        footL: { x: -s.height * 0.115 },
        footR: { x: s.height * 0.12 },
        armL: { shoulder: -0.25, elbow: 0.65 },
        armR: { shoulder: 0.65 + shake * 0.045, elbow: 1.85 + shake * 0.06 },
      };
    },
  },

  startled: {
    label: "Scared",
    group: "Emotions",
    duration: 1.8,
    loop: false,
    pose(t, s) {
      const recoil = segment(t, 0.04, 0.22) * (1 - segment(t, 0.55, 1));
      return {
        bob: -s.height * 0.04 * recoil,
        torso: 0.03 - 0.28 * recoil,
        head: -0.12 * recoil,
        shoulderLift: recoil * 0.7,
        footL: { x: -s.height * 0.11 },
        footR: { x: s.height * 0.12 },
        armL: { shoulder: -0.1 + recoil * 0.65, elbow: 0.2 + recoil * 1.6 },
        armR: { shoulder: 0.1 + recoil * 0.8, elbow: 0.2 + recoil * 1.6 },
      };
    },
  },

  celebrate: {
    label: "Celebrate",
    group: "Emotions",
    duration: 2.4,
    loop: false,
    pose(t, s) {
      const raise = segment(t, 0.04, 0.3) * (1 - segment(t, 0.72, 1));
      const bounce = (1 - Math.cos(t * TAU * 3)) * 0.5 * raise;
      return {
        bob: -s.height * 0.014 * bounce,
        torso: 0.03 - raise * 0.06,
        head: -raise * 0.08,
        shoulderLift: raise * 0.3,
        footL: { x: -s.height * 0.1 },
        footR: { x: s.height * 0.105 },
        armL: { shoulder: -0.1 - raise * 2.1, elbow: 0.2 - raise * 0.65 },
        armR: { shoulder: 0.1 + raise * 2.1, elbow: 0.2 + raise * 0.25 },
      };
    },
  },

  dejected: {
    label: "Sad",
    group: "Emotions",
    duration: 3.6,
    loop: true,
    pose(t, s) {
      const breath = Math.sin(t * TAU);
      return {
        bob: -s.height * 0.025 + breath * 0.35,
        torso: 0.2 + breath * 0.008,
        head: 0.3,
        shoulderLift: -0.45,
        footL: { x: -s.height * 0.08 },
        footR: { x: s.height * 0.09 },
        armL: { shoulder: -0.08, elbow: 0.12 },
        armR: { shoulder: 0.04, elbow: 0.12 },
      };
    },
  },

  kick: {
    label: "Kick",
    group: "Actions",
    duration: 1.3,
    loop: false,
    pose(t, s) {
      const kick = pulse(t, 0.12, 0.58);
      const settle = pulse(t, 0.58, 0.92);
      return {
        bob: -s.height * 0.02 * kick + s.height * 0.008 * settle,
        torso: -0.08 * kick + 0.05 * settle,
        head: 0.04 * kick,
        footL: { x: -s.hipHalf * 0.95, angle: -0.02 },
        footR: {
          x: s.hipHalf + s.legLength * 0.62 * kick,
          y: s.legLength * 0.5 * kick,
          angle: -0.55 * kick,
        },
        armL: { shoulder: -0.15 - 0.55 * kick, elbow: 0.3 + 0.35 * kick },
        armR: { shoulder: 0.15 + 0.85 * kick, elbow: 0.35 + 0.4 * kick },
      };
    },
  },

  sit: {
    label: "Sit",
    group: "Postures",
    posture: "sit",
    duration: 4,
    loop: true,
    pose(t, s) {
      return {
        bob: -s.hipHeight + s.height * 0.09,
        torso: 0.08 + Math.sin(t * TAU) * 0.008,
        head: -0.06,
        footL: { x: s.height * 0.32, angle: -0.08 },
        footR: { x: s.height * 0.4, angle: -0.08 },
        armL: { shoulder: 0.65, elbow: 0.8 },
        armR: { shoulder: 0.8, elbow: 0.65 },
        handL: { x: s.height * 0.17, y: -s.height * 0.16 },
        handR: { x: s.height * 0.24, y: -s.height * 0.14 },
      };
    },
  },

  lie: {
    label: "Lie down",
    group: "Postures",
    posture: "lie",
    duration: 4,
    loop: true,
    pose(t, s) {
      return {
        bob: -s.hipHeight + s.headRadius,
        torso: -1.48 + Math.sin(t * TAU) * 0.004,
        head: -0.04,
        armBendL: -1,
        footL: { x: s.legLength * 0.88, angle: -0.15 },
        footR: { x: s.legLength * 0.96, angle: -0.15 },
        handL: { x: -s.height * 0.18, y: -s.height * 0.065 },
        handR: { x: s.height * 0.04, y: -s.height * 0.075 },
      };
    },
  },

  kneel: {
    label: "Kneel",
    group: "Postures",
    posture: "kneel",
    duration: 4,
    loop: true,
    pose(t, s) {
      return {
        bob: -s.hipHeight + s.upperLeg * 0.9,
        torso: 0.12 + Math.sin(t * TAU) * 0.008,
        head: -0.08,
        footL: { x: -s.height * 0.112, angle: -0.1 },
        footR: { x: s.height * 0.23 },
        armL: { shoulder: -0.15, elbow: 0.35 },
        armR: { shoulder: 0.65, elbow: 0.7 },
        handL: { x: -s.height * 0.1, y: -s.height * 0.12 },
        handR: { x: s.height * 0.18, y: -s.height * 0.2 },
      };
    },
  },

  fall: {
    label: "Fall",
    group: "Postures",
    duration: 1.9,
    loop: false,
    endPosture: "sit",
    pose(t, s) {
      const drop = segment(t, 0.08, 0.5);
      const flail = pulse(t, 0.02, 0.4);
      const stumble = pulse(t, 0.02, 0.36);
      const impact = pulse(t, 0.48, 0.72);
      const brace = segment(t, 0.28, 0.42);
      const settle = segment(t, 0.62, 0.95);
      return {
        rootX: -s.height * 0.05 * drop,
        bob: -s.height * 0.37 * drop + impact * s.height * 0.018,
        torso: 0.04 - 0.58 * drop,
        head: 0.1 + 0.2 * drop - impact * 0.03,
        shoulderLift: -0.2 * drop,
        footL: {
          x: -s.height * 0.08 + s.height * 0.24 * drop,
          y: s.height * 0.03 * flail,
          angle: 0.12 * drop,
        },
        footR: {
          x: s.height * 0.09 + s.height * 0.3 * drop,
          y: s.height * 0.06 * stumble + s.height * 0.03 * flail,
          angle: 0.18 * drop,
        },
        armL: { shoulder: -0.12 - 2.1 * flail - 0.35 * settle, elbow: 0.22 + 0.35 * flail },
        armR: { shoulder: 0.12 + 2.1 * flail - 0.35 * settle, elbow: 0.2 + 0.4 * flail },
        handL: { x: -s.height * 0.28, y: -s.height * 0.075 },
        handR: { x: -s.height * 0.16, y: -s.height * 0.07 },
        handWeightL: brace,
        handWeightR: brace,
      };
    },
  },
};

export const clipList = Object.entries(clips).map(([id, clip]) => ({ id, ...clip }));
export const clipGroups = ["Loops", "Actions", "Emotions", "Postures"];
