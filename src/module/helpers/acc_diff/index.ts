import { TagInstance } from "machine-mind";
import * as t from 'io-ts';

import { LancerActor, LancerActorType } from "../../actor/lancer-actor";
import ReactiveForm from '../reactive-form';
import { AccDiffPlugin, AccDiffPluginData, AccDiffPluginCodec } from './plugin';
import { enclass, encode, decode } from './serde';
import { LancerItem } from "../../item/lancer-item";

import { Invisibility } from "./invisibility";

enum Cover {
  None = 0,
  Soft = 1,
  Hard = 2
}
let coverSchema = t.union([t.literal(0), t.literal(1), t.literal(2)]);

// so normally you wouldn't keep the codecs with the classes like this
// the entire point of io-ts is that the co/dec logic is separable
// but here we want plugins to actually modify the codecs, so, sigh
class AccDiffWeapon {
  accurate: boolean;
  inaccurate: boolean;
  seeking: boolean;
  plugins: { [k: string]: AccDiffPluginData };

  static pluginSchema: { [k: string]: AccDiffPluginCodec<any, any, any> } = {

  };

  static get schema() {
    return {
      accurate: t.boolean,
      inaccurate: t.boolean,
      seeking: t.boolean,
      plugins: t.type(this.pluginSchema),
    }
  }

  static get schemaCodec() {
    return t.type(this.schema);
  }
  static get codec() { return enclass(this.schemaCodec, AccDiffWeapon) }

  constructor(obj: t.TypeOf<typeof AccDiffWeapon.schemaCodec>) {
    this.accurate = obj.accurate;
    this.inaccurate = obj.inaccurate;
    this.seeking = obj.seeking;
    this.plugins = obj.plugins;
  }

  get raw() {
    return {
      accurate: this.accurate,
      inaccurate: this.inaccurate,
      seeking: this.seeking,
      plugins: this.plugins
    }
  }

  hydrate(d: AccDiffData) {
    for (let key of Object.keys(this.plugins)) {
      this.plugins[key].hydrate(d);
    }
  }
}

class AccDiffBase {
  accuracy: number;
  difficulty: number;
  cover: Cover;
  plugins: { [k: string]: AccDiffPluginData };
  #weapon!: AccDiffWeapon; // never use this class before calling hydrate

  static pluginSchema: { [k: string]: AccDiffPluginCodec<any, any, any> } = {

  };

  static get schema() {
    return {
      accuracy: t.number,
      difficulty: t.number,
      cover: coverSchema,
      plugins: t.type(this.pluginSchema)
    }
  }
  static get schemaCodec() { return t.type(this.schema); }
  static get codec() { return enclass(this.schemaCodec, AccDiffBase) }

  constructor(obj: t.TypeOf<typeof AccDiffBase.schemaCodec>) {
    this.accuracy = obj.accuracy;
    this.difficulty = obj.difficulty;
    this.cover = obj.cover;
    this.plugins = obj.plugins;
    // this.#weapon = weapon;
  }

  get raw() {
    return { accuracy: this.accuracy, difficulty: this.difficulty, cover: this.cover, plugins: this.plugins }
  }

  hydrate(d: AccDiffData) {
    this.#weapon = d.weapon;
    for (let key of Object.keys(this.plugins)) {
      this.plugins[key].hydrate(d, this);
    }
  }

  get total() {
    return this.accuracy - this.difficulty
      + (this.#weapon.accurate ? 1 : 0)
      - (this.#weapon.inaccurate ? 1 : 0)
      - (this.#weapon.seeking ? 0 : this.cover)
  }
}

// we _want_ to extend AccDiffBase
// but ... typescript checks type compatibility between _static_ methods
// and that + io-ts I think has the variance wrong
// so if you extend AccDiffBase it's trying to assign AccDiffBase to AccDiffTarget
export class AccDiffTarget {
  target: Token;
  accuracy: number;
  difficulty: number;
  cover: Cover;
  consumeLockOn: boolean;
  plugins: { [k: string]: any };
  #weapon!: AccDiffWeapon; // never use this class before calling hydrate
  #base!: AccDiffBase; // never use this class before calling hydrate

  static pluginSchema: { [k: string]: AccDiffPluginCodec<any, any, any> } = {

  };

  static get schema() {
    return {
      target_id: t.string,
      accuracy: t.number,
      difficulty: t.number,
      cover: coverSchema,
      consumeLockOn: t.boolean,
      plugins: t.type(this.pluginSchema),
    }
  }

  static get schemaCodec() { return t.type(this.schema); }
  static get codec() { return enclass(this.schemaCodec, AccDiffTarget) }

  constructor(obj: t.TypeOf<typeof AccDiffTarget.schemaCodec>) {
    let target = canvas.scene.tokens.get(obj.target_id);
    if (!target) {
      ui.notifications.error("Trying to access tokens from a different scene!");
      throw new Error("Token not found");
    }

    this.target = target.object;
    this.accuracy = obj.accuracy;
    this.difficulty = obj.difficulty;
    this.cover = obj.cover;
    this.consumeLockOn = obj.consumeLockOn;
    this.plugins = obj.plugins;
    // this.#weapon = weapon;
    // this.#base = base;
  }

  get raw() {
    return {
      target_id: this.target.id,
      accuracy: this.accuracy,
      difficulty: this.difficulty,
      cover: this.cover,
      consumeLockOn: this.consumeLockOn,
      plugins: this.plugins,
    }
  }

  hydrate(d: AccDiffData) {
    this.#weapon = d.weapon;
    this.#base = d.base;
    for (let key of Object.keys(this.plugins)) {
      this.plugins[key].hydrate(d, this);
    }
  }

  // as it turns out, we can't actually name the ActiveEffect type
  // it's fine, this is all we need here
  get usingLockOn(): null | { delete: () => void } {
    return (this.consumeLockOn && this.lockOnAvailable) || null;
  }

  get lockOnAvailable(): null | { delete: () => void } {
    let actor = (this.target.actor as LancerActor<LancerActorType>);
    return actor.data.effects.find(eff => eff.data.flags.core.statusId == "lockon");
  }

  get total() {
    let base = this.accuracy - this.difficulty
      + (this.#weapon.accurate ? 1 : 0)
      - (this.#weapon.inaccurate ? 1 : 0)
      - (this.#weapon.seeking ? 0 : this.cover);
    // the only thing we actually use base for is the untyped bonuses
    let raw = base + this.#base.accuracy - this.#base.difficulty;
    let lockon = this.usingLockOn ? 1 : 0;

    return raw + lockon;
  }
}

export type AccDiffDataSerialized = t.TypeOf<typeof AccDiffData.schemaCodec>;
export class AccDiffData {
  title: string;
  weapon: AccDiffWeapon;
  base: AccDiffBase;
  targets: AccDiffTarget[];

  static get schema() {
    return {
      title: t.string,
      weapon: AccDiffWeapon.codec,
      base: AccDiffBase.codec,
      targets: t.array(AccDiffTarget.codec)
    }
  }

  static get schemaCodec() { return t.type(this.schema); }
  static get codec() { return enclass(this.schemaCodec, AccDiffData) }

  constructor(obj: t.TypeOf<typeof AccDiffData.schemaCodec>) {
    this.title = obj.title;
    this.weapon = obj.weapon;
    this.base = obj.base;
    this.targets = obj.targets;

    this.weapon.hydrate(this);
    this.base.hydrate(this);
    for (let target of this.targets) { target.hydrate(this); }
  }

  get raw() {
    return {
      title: this.title,
      weapon: this.weapon,
      base: this.base,
      targets: this.targets,
    }
  }

  static fromObject(obj: t.InputOf<typeof AccDiffData.codec>) {
    return decode(obj, AccDiffData.codec);
  }

  toObject(): t.OutputOf<typeof AccDiffData.codec> {
    return encode(this, AccDiffData.codec);
  }

  static plugins: AccDiffPlugin<AccDiffPluginData>[] = [];
  static targetedPlugins: AccDiffPlugin<AccDiffPluginData>[] = [];
  static registerPlugin<D extends AccDiffPluginData, P extends AccDiffPlugin<D>, O>(plugin: P) {
    if (plugin.perRoll) {
      AccDiffWeapon.pluginSchema[plugin.slug] = plugin.codec;
    }
    if (plugin.perUnknownTarget) {
      AccDiffBase.pluginSchema[plugin.slug] = plugin.codec;
    }
    if (plugin.perTarget) {
      AccDiffTarget.pluginSchema[plugin.slug] = plugin.codec;
      this.targetedPlugins.push(plugin);
    }
    this.plugins.push(plugin);
  }

  static fromParams(
    item?: LancerItem<any>,
    tags?: TagInstance[],
    title?: string,
    targets?: Token[],
    starting?: [number, number]
  ): AccDiffData {
    let weapon = {
      accurate: false,
      inaccurate: false,
      seeking: false,
      plugins: {} as { [k: string]: any },
    };

    for (let tag of (tags || [])) {
      switch (tag.Tag.LID) {
        case "tg_accurate":
          weapon.accurate = true;
          break;
        case "tg_inaccurate":
          weapon.inaccurate = true;
          break;
        case "tg_seeking":
          weapon.seeking = true;
          break;
      }
    }

    let base = {
      cover: Cover.None,
      accuracy: starting ? starting[0] : 0,
      difficulty: starting ? starting[1] : 0,
      plugins: {} as { [k: string]: any },
    };

    let obj = {
      title: title ? `${title} - Accuracy and Difficulty` : "Accuracy and Difficulty",
      weapon, base,
      targets: (targets || []).map(t => {
        let ret = {
          target_id: t.id,
          accuracy: 0,
          difficulty: 0,
          cover: Cover.None,
          consumeLockOn: true,
          plugins: {} as { [k: string]: any },
        };
        for (let plugin of this.targetedPlugins) {
          ret.plugins[plugin.slug] = encode(plugin.perTarget!(t), plugin.codec);
        }
        return ret;
      })
    };

    for (let plugin of this.plugins) {
      if (plugin.perRoll) {
        obj.weapon.plugins[plugin.slug] = encode(plugin.perRoll(item), plugin.codec);
      }
      if (plugin.perUnknownTarget) {
        obj.base.plugins[plugin.slug] = encode(plugin.perUnknownTarget(), plugin.codec);
      }
    }
    return AccDiffData.fromObject(obj);
  }
}

type AccDiffView = AccDiffData & {
  hasTargets: boolean,
  hasExactlyOneTarget: boolean,
}

export class AccDiffForm extends ReactiveForm<AccDiffData, AccDiffView> {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/lancer/templates/window/acc_diff.hbs",
      resizable: false,
    });
  }

  constructor(data: AccDiffData) {
    super(data, { title: data.title })
  }

  getViewModel(data: AccDiffData): AccDiffView {
    let ret = data as AccDiffView; // view elements haven't been set yet
    ret.hasTargets = ret.targets.length > 1;
    ret.hasExactlyOneTarget = ret.targets.length == 1;
    return ret
  }
}

// side effects for importing, yes, yes, I know
AccDiffData.registerPlugin(Invisibility);
