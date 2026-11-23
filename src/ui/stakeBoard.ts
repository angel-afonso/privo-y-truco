import { Container, Graphics, Text } from "pixi.js";
import type { tableStake } from "./tableBids";
import { FONT_DISPLAY, FONT_UI, PALETTE } from "./theme";

export class StakeBoard extends Container {
  private paper = new Graphics();
  private amount = new Text({ style: { fontFamily: FONT_DISPLAY, fontWeight: "700", fill: 0x26372b } });
  private caption = new Text({ style: { fontFamily: FONT_UI, fontWeight: "800", fontSize: 10, letterSpacing: 1.3, fill: 0x675d48 } });
  private title = new Text({ style: { fontFamily: FONT_DISPLAY, fontWeight: "700", fill: 0x26372b } });
  private note = new Text({ style: { fontFamily: FONT_UI, fontWeight: "600", fontSize: 11, fill: 0x5a5749 } });

  private detail = new Text({ style: {
    fontFamily: FONT_UI, fontSize: 11, lineHeight: 14, fontWeight: "600", fill: 0x575344,
  } });

  constructor() {
    super();
    this.eventMode = "none";
    this.addChild(this.paper, this.amount, this.caption, this.title, this.note, this.detail);
  }

  public update(stake: ReturnType<typeof tableStake>, width: number, compact: boolean): void {
    const height = compact ? 57 : 110;
    const inset = compact ? 12 : 16;
    const dividingX = compact ? 59 : 85;
    const ink = stake.status === "Por aceptar" ? 0x85372d : 0x25382b;
    this.paper.clear()
      .roundRect(0, 2, width, height, 3).fill({ color: 0x06140d, alpha: 0.45 })
      .roundRect(0, 0, width, height, 3).fill(PALETTE.ivoryWarm)
      .rect(3, 3, width - 6, height - 6).stroke({ color: 0xb9ab8e, width: 0.8 })
      .moveTo(dividingX, 9).lineTo(dividingX, compact ? height - 9 : 74).stroke({ color: 0xb9ab8e, width: 1 });
    this.amount.text = String(stake.value);
    this.amount.style.fontSize = compact ? 28 : 45;
    this.amount.style.fill = ink;
    this.amount.anchor.set(0.5);
    this.amount.position.set(dividingX / 2, compact ? 20 : 34);
    this.caption.text = stake.value === 1 ? "PIEDRA" : "PIEDRAS";
    this.caption.style.fontSize = compact ? 8.5 : 9;
    this.caption.anchor.set(0.5);
    this.caption.position.set(dividingX / 2, compact ? 41 : 62);
    this.title.text = stake.name;
    this.title.style.fontSize = compact ? 17 : 23;
    this.title.scale.set(1);
    this.title.scale.set(Math.min(1, (width - dividingX - 2 * inset) / this.title.width));
    this.title.position.set(dividingX + inset, compact ? 5 : 17);
    this.note.text = stake.status.toUpperCase();
    this.note.style.fill = ink;
    this.note.style.letterSpacing = 1.05;
    this.note.position.set(dividingX + inset, compact ? 31 : 49);
    this.detail.text = stake.detail.split(" / ").join("\n");
    this.detail.scale.set(1);
    if (compact) {
      this.detail.style.wordWrap = true;
      this.detail.style.wordWrapWidth = Math.max(70, width * 0.33);
      this.detail.anchor.set(1, 0.5);
      this.detail.position.set(width - inset, height / 2);
      this.detail.scale.set(Math.min(1, (height - 8) / this.detail.height));
      this.title.scale.set(Math.min(1, (width * 0.62 - dividingX - inset) / Math.max(1, this.title.getLocalBounds().width)));
    } else {
      this.paper.moveTo(inset, 77).lineTo(width - inset, 77).stroke({ color: 0xb9ab8e, width: 1 });
      this.detail.style.wordWrap = false;
      this.detail.anchor.set(0, 0.5);
      this.detail.position.set(inset, 92);
      this.detail.scale.set(Math.min(1, (width - 2 * inset) / this.detail.width, 27 / this.detail.height));
    }
  }
}
