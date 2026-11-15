import Phaser from "phaser";
import "./style.css";

const width = 1024;
const height = 576;
const sceneDuration = 7200;
const endingDuration = 1650;
const amber = 0xffb36d;
const bright = 0xeee8d9;
const stroke = 0x48515e;
const outline = 0x080b10;

const caption = document.querySelector("#caption");
const progress = document.querySelector("#progress");
const choices = document.querySelector("#choices");
const play = document.querySelector("#play");
const openDoor = document.querySelector("#open-door");
const leave = document.querySelector("#leave");

function polygon(graphics, color, points, alpha = 1) {
  graphics.fillStyle(color, alpha);
  graphics.fillPoints(points.map(([x, y]) => ({ x, y })), true);
}

function line(graphics, size, color, points, alpha = 1) {
  graphics.lineStyle(size, color, alpha);
  graphics.beginPath();
  graphics.moveTo(...points[0]);
  for (const [x, y] of points.slice(1)) graphics.lineTo(x, y);
  graphics.strokePath();
}

function drawCorridor(graphics) {
  graphics.fillStyle(0x1d2430).fillRect(0, 0, width, height);
  polygon(graphics, 0x121821, [[0, 0], [1024, 0], [909, 129], [212, 129]]);
  polygon(graphics, 0x161b24, [[212, 129], [212, 406], [0, 576], [0, 0]]);
  polygon(graphics, 0x151b25, [[909, 129], [1024, 0], [1024, 576], [909, 411]]);
  polygon(graphics, 0x2b323d, [[0, 576], [212, 406], [909, 406], [1024, 576]]);
  polygon(graphics, 0x3c3c41, [[606, 414], [828, 414], [979, 576], [459, 576]], 0.65);

  for (const y of [421, 445, 484, 543]) {
    line(graphics, 1, 0x62626a, [[0, y], [1024, y]], 0.34);
  }

  for (const x of [208, 393, 640, 838]) {
    line(graphics, 1, 0x62626a, [[535 + (x - 535) * 0.32, 407], [x, 576]], 0.34);
  }

  for (const x of [242, 352, 462]) {
    graphics.fillStyle(0x181e27).fillRect(x, 168, 100, 219);
    graphics.lineStyle(1, 0x3c4551).strokeRect(x, 168, 100, 219);
    graphics.fillStyle(stroke, 0.55).fillRect(x + 12, 181, 53, 2);
    graphics.fillStyle(0x303945).fillRect(x + 12, 354, 76, 5);
  }

  polygon(graphics, 0x343e4a, [[0, 0], [65, 0], [243, 137], [243, 413], [52, 576], [0, 576], [208, 402], [208, 150]]);
  line(graphics, 2, 0x647080, [[35, 0], [226, 143], [226, 408], [28, 576]], 0.6);
  polygon(graphics, 0x323a47, [[1011, 0], [1024, 0], [1024, 52], [932, 146], [932, 409], [1024, 538], [1024, 576], [897, 420], [897, 129]]);
  line(graphics, 2, 0x66707d, [[1024, 17], [913, 135], [913, 414], [1024, 560]], 0.54);

  polygon(graphics, amber, [[481, 94], [815, 94], [973, 576], [264, 576]], 0.033);
  polygon(graphics, amber, [[520, 93], [811, 93], [912, 576], [363, 576]], 0.027);
  polygon(graphics, amber, [[286, 88], [819, 88], [841, 113], [305, 113]], 0.09);
  polygon(graphics, amber, [[286, 94], [819, 94], [828, 104], [297, 104]], 0.3);
  polygon(graphics, 0xffd6a1, [[288, 95], [818, 95], [822, 99], [293, 99]], 0.9);

  graphics.fillStyle(0x141820).fillRect(568, 179, 14, 222);
  graphics.fillStyle(0x656978).fillRect(574, 181, 3, 223);
  graphics.fillStyle(0x0d1118).fillRoundedRect(548, 285, 39, 60, 5);
  graphics.lineStyle(2, 0x4a505d).strokeRoundedRect(548, 285, 39, 60, 5);
  graphics.fillStyle(0x65402e).fillRect(557, 310, 21, 4);
  graphics.fillStyle(0x4a4e58).fillRect(557, 321, 12, 2);

  for (let index = 0; index < 9; index++) {
    const x = 612 + index * 27;
    polygon(graphics, amber, [[x, 414], [x + 14, 414], [x + 7, 424], [x - 9, 424]], 0.55);
  }
}

function drawAirlock(graphics, opening, alarm) {
  graphics.clear();
  polygon(graphics, 0x0d1118, [[591, 173], [618, 146], [827, 146], [857, 175], [857, 415], [591, 415]]);
  polygon(graphics, 0x3a3e48, [[601, 180], [625, 157], [821, 157], [846, 180], [846, 411], [601, 411]]);
  graphics.fillStyle(0x0a0d13).fillRect(613, 185, 221, 225);

  if (opening > 0) {
    graphics.fillStyle(0x52262b).fillRect(613, 185, 221, 225);
    polygon(graphics, 0xe35345, [[704, 185], [743, 185], [799, 410], [647, 410]], 0.28);
    graphics.fillStyle(0x160e17).fillCircle(724, 241, 23);
    polygon(graphics, 0x160e17, [[715, 254], [736, 254], [763, 303], [758, 378], [692, 378], [688, 304]]);
    graphics.fillStyle(0xff7f64).fillCircle(716, 240, 2).fillCircle(733, 240, 2);
  }

  const panelWidth = 110 * (1 - 0.83 * opening);
  graphics.fillStyle(0x262c36).fillRect(613, 185, panelWidth, 225);
  graphics.fillStyle(0x303640).fillRect(835 - panelWidth, 185, panelWidth, 225);
  graphics.lineStyle(2, 0x555963).strokeRect(613, 185, panelWidth, 225);
  graphics.strokeRect(835 - panelWidth, 185, panelWidth, 225);
  graphics.fillStyle(0x6d5745, 0.7).fillRect(614, 193, 4, 207).fillRect(829, 193, 4, 207);
  graphics.fillStyle(amber, alarm).fillCircle(625, 170, 3);
  graphics.fillStyle(0x97999c).fillRect(804, 166, 20, 2);
  graphics.fillStyle(amber, alarm).fillCircle(567, 299, 3);
}

function drawHero(graphics, x, y, elapsed, motion, facing) {
  const phase = elapsed * 0.011;
  const swing = Math.sin(phase) * motion;
  const bob = Math.abs(Math.sin(phase)) * motion * 5 + Math.sin(elapsed * 0.003) * 2;
  const hips = -64 - bob;
  const shoulder = -123 - bob;

  graphics.clear();
  graphics.setPosition(x, y).setScale(facing, 1);
  graphics.fillStyle(outline, 0.2).fillEllipse(-2, 5, 114, 27);
  graphics.fillStyle(outline, 0.42).fillEllipse(-2, 5, 77, 15);

  line(graphics, 8, 0x999ca3, [[0, hips], [-13 - swing * 10, -34], [-20 - swing * 21, -3]]);
  line(graphics, 8, 0x999ca3, [[1, shoulder + 5], [-18 + swing * 9, -91], [-11 + swing * 16, -75]]);
  line(graphics, 11, outline, [[9, shoulder], [0, hips], [17 + swing * 11, -36], [21 + swing * 21, -3]]);
  line(graphics, 7, bright, [[9, shoulder], [0, hips], [17 + swing * 11, -36], [21 + swing * 21, -3], [30 + swing * 21, -3]]);
  line(graphics, 7, bright, [[9, shoulder + 3], [24 - swing * 10, -96], [31 - swing * 13, -92 - 15 * (1 - motion)]]);

  const headY = -149 - bob;
  graphics.fillStyle(outline).fillCircle(12, headY, 24);
  graphics.fillStyle(bright).fillCircle(12, headY, 20);
  graphics.fillStyle(outline).fillRoundedRect(16, headY - 8, 18, 13, 4);
  graphics.fillStyle(amber).fillRect(23, headY - 4, 8, 3);
  line(graphics, 7, amber, [[14, shoulder - 1], [0, shoulder], [-12, shoulder + 11], [-29, shoulder + 11 + Math.sin(phase) * 3]]);
}

class AirlockScene extends Phaser.Scene {
  create() {
    drawCorridor(this.add.graphics());
    this.airlock = this.add.graphics();
    this.hero = this.add.graphics();
    this.add.text(646, 198, "AIRLOCK", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#a3a4a9",
      letterSpacing: 2,
    });
    this.add.text(763, 206, "04", {
      fontFamily: "monospace",
      fontSize: "31px",
      color: "#8b8e95",
    });
    this.renderFrame(294, 0, 0, 1, 0, 0.75);
    this.phase = "ready";

    play.disabled = false;
    play.addEventListener("click", () => this.startScene());
    openDoor.addEventListener("click", () => this.choose("open"));
    leave.addEventListener("click", () => this.choose("leave"));
  }

  startScene() {
    this.elapsed = 0;
    this.phase = "playing";
    caption.textContent = "За дверью слышен стук.";
    progress.style.transform = "scaleX(0)";
    play.hidden = true;
  }

  choose(choice) {
    this.elapsed = 0;
    this.phase = choice;
    choices.hidden = true;
    caption.textContent = choice === "open" ? "Замок поддаётся." : "Герой отходит от шлюза.";
  }

  renderFrame(x, elapsed, motion, facing, opening, alarm) {
    drawAirlock(this.airlock, opening, alarm);
    drawHero(this.hero, x, 465, elapsed, motion, facing);
  }

  update(_time, delta) {
    if (this.phase === "playing") {
      this.elapsed = Math.min(this.elapsed + delta, sceneDuration);
      const walkProgress = Phaser.Math.Clamp((this.elapsed - 750) / 3300, 0, 1);
      const motion = Math.min(walkProgress * 15, (1 - walkProgress) * 15, 1);
      const x = Phaser.Math.Linear(294, 501, walkProgress);
      const alarm = 0.58 + Math.sin(this.elapsed * 0.009) * 0.33;
      this.renderFrame(x, this.elapsed, motion, 1, 0, alarm);
      progress.style.transform = `scaleX(${this.elapsed / sceneDuration})`;

      if (this.elapsed === sceneDuration) {
        this.phase = "choosing";
        caption.textContent = "Из-за двери доносится голос. «Это я. Открой».";
        choices.hidden = false;
      } else if (this.elapsed >= 4200 && caption.textContent === "За дверью слышен стук.") {
        caption.textContent = "Стук повторяется. На этот раз изнутри.";
      }
    } else if (this.phase === "open" || this.phase === "leave") {
      this.elapsed = Math.min(this.elapsed + delta, endingDuration);
      const fraction = this.elapsed / endingDuration;
      const opening = this.phase === "open";
      const x = opening ? 501 - 18 * fraction : 501 - 250 * fraction;
      const motion = opening ? 0 : Math.min((1 - fraction) * 8, 1);
      const door = opening ? Phaser.Math.Easing.Sine.InOut(fraction) : 0;
      this.renderFrame(x, this.elapsed, motion, opening ? 1 : -1, door, 0.9);

      if (fraction === 1) {
        this.phase = "complete";
        caption.textContent = opening ? "За шлюзом кто-то есть." : "Стук затихает. Герой уходит.";
        play.textContent = "Сыграть заново";
        play.hidden = false;
      }
    }
  }
}

play.disabled = true;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "stage",
  width,
  height,
  backgroundColor: "#121720",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: AirlockScene,
});
