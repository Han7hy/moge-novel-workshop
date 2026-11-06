/* ============ building.js —— 建筑立面图生成器 ============ */
/**
 * 把「地点设定」变成一张能用的建筑立面图。
 * 纯程序化绘制 SVG：不依赖图像模型，出图是矢量的、可缩放、风格统一。
 * LLM 只负责把设定翻译成结构参数，剩下全是几何计算。
 */
const Building = {
  /* 时间 / 天气 → 天空与光 */
  SKY: {
    day: { top: '#b9d4e6', bot: '#f4f0e5', glow: '#fff8e2', ink: '#3c3a36', far: '#9fb0b6', lit: 0.15 },
    dusk: { top: '#7b8ca6', bot: '#e9c49c', glow: '#ffd89c', ink: '#2b292b', far: '#7d8794', lit: 0.55 },
    night: { top: '#121a25', bot: '#2b3a49', glow: '#ffd275', ink: '#0d1218', far: '#2c3742', lit: 0.8 },
    fog: { top: '#c9d0cd', bot: '#edeff0', glow: '#f7f3e4', ink: '#4b504f', far: '#bcc3c0', lit: 0.3 }
  },

  /* 建筑类型模板：给 LLM 选，同时约束默认几何 */
  TYPES: {
    palace: { label: '仙宫', floors: [2, 4], bays: [4, 6], roof: 'curved', wall: '#c4b9a8', trim: '#8a7d6e' },
    shrine: { label: '神殿', floors: [1, 2], bays: [3, 5], roof: 'hip', wall: '#b8a898', trim: '#7a6a5a' },
    cave: { label: '洞府', floors: [1, 2], bays: [2, 3], roof: 'arch', wall: '#7a7568', trim: '#5a5548' },
    pavilion: { label: '亭台', floors: [1, 2], bays: [2, 3], roof: 'curved', wall: '#a89880', trim: '#786850' },
    altar: { label: '祭坛', floors: [1, 1], bays: [3, 4], roof: 'flat', wall: '#9a8a7a', trim: '#6a5a4a' },
    island: { label: '浮岛', floors: [1, 2], bays: [2, 4], roof: 'pagoda', wall: '#b0a898', trim: '#807868' },
    fortress: { label: '关隘', floors: [2, 3], bays: [3, 5], roof: 'flat', wall: '#8a8078', trim: '#5a5048' },
    abyss: { label: '深渊', floors: [1, 2], bays: [2, 3], roof: 'shed', wall: '#6a5a5a', trim: '#4a3a3a' }
  },

  DEFAULTS: {
    type: 'palace',
    floors: 3,
    bays: 5,
    roof: 'curved',
    wall: '#c4b9a8',
    trim: '#8a7d6e',
    roofColor: '#6e6259',
    door: 'single',
    windows: 'lattice',
    sign: '',
    signStyle: 'board',
    extras: [],
    time: 'dusk',
    note: ''
  },

  /* ---------- 主渲染 ---------- */
  render(raw, opt) {
    opt = opt || {};
    const S = Object.assign({}, this.DEFAULTS, raw || {});
    const T = this.TYPES[S.type] || this.TYPES.brick;
    const sky = this.SKY[S.time] || this.SKY.dusk;

    const floors = this.clampI(S.floors, 1, 6);
    const bays = this.clampI(S.bays, 2, 7);
    const extras = Array.isArray(S.extras) ? S.extras : [];

    const W = 440;
    const H = 340;
    const groundY = 272;
    const floorH = 48;
    const bayW = 38;
    const bodyW = bays * bayW + 30;
    const bodyH = floors * floorH;
    const bx = Math.round((W - bodyW) / 2);
    const by = groundY - bodyH;
    const roofColor = S.roofColor || T.trim;

    const p = [];
    p.push(this.defs(S, sky));

    /* --- 天空 --- */
    p.push(`<rect width="${W}" height="${H}" fill="url(#skyGrad)"/>`);

    /* --- 远处天际线 --- */
    p.push(this.skyline(W, H, groundY, sky));

    /* --- 地面 --- */
    p.push(`<rect x="0" y="${groundY}" width="${W}" height="${H - groundY}" fill="${this.shade(sky.bot, -12)}"/>`);
    p.push(`<line x1="0" y1="${groundY}" x2="${W}" y2="${groundY}" stroke="${this.shade(sky.ink, 40)}" stroke-width="1" opacity=".35"/>`);

    /* --- 附属建筑（烟囱 / 水塔 在主体之后，阳台 / 雨棚 之前） --- */
    const behind = [];
    const front = [];

    /* 烟囱 */
    if (extras.includes('chimney')) {
      behind.push(this.chimney(bx + bodyW - 26, by, sky, roofColor));
    }
    /* 水塔 */
    if (extras.includes('watertank')) {
      behind.push(this.watertank(bx + bodyW * 0.28, by, sky, roofColor));
    }
    /* 旗杆 */
    if (extras.includes('flag')) {
      behind.push(this.flagpole(bx + 12, by, sky));
    }
    p.push(behind.join(''));

    /* --- 主体 --- */
    p.push(this.body(bx, by, bodyW, bodyH, S, T, sky, floors, bays, floorH, bayW));

    /* --- 屋顶 --- */
    p.push(this.roof(bx, by, bodyW, S.roof, roofColor, sky, S, T));

    /* --- 门窗 --- */
    p.push(this.openings(bx, by, bodyW, bodyH, S, T, sky, floors, bays, floorH, bayW));

    /* --- 招牌 --- */
    if (S.sign) {
      p.push(this.sign(bx, by, bodyW, S, sky));
    }

    /* --- 前景附属 --- */
    if (extras.includes('awning')) front.push(this.awning(bx, groundY, bodyW, S, sky));
    if (extras.includes('balcony')) front.push(this.balcony(bx, by, bodyW, bodyH, floorH, S, sky));
    if (extras.includes('stairs')) front.push(this.stairs(bx + bodyW / 2 - 26, groundY, S, sky));
    if (extras.includes('crates')) front.push(this.crates(bx - 6, groundY, sky));
    if (extras.includes('lantern')) front.push(this.lanterns(bx, by, bodyW, bodyH, sky));
    if (extras.includes('neon')) front.push(this.neon(bx, by, bodyW, S, sky));
    p.push(front.join(''));

    /* --- 电线 --- */
    if (extras.includes('wires')) p.push(this.wires(W, sky));

    /* --- 说明 --- */
    if (S.note && !opt.thumb) {
      p.push(
        `<text x="${W / 2}" y="${H - 12}" text-anchor="middle" font-size="12" fill="${sky.ink}" opacity=".62" font-family="'Songti SC','Noto Serif SC',serif">${esc(
          String(S.note).slice(0, 34)
        )}</text>`
      );
    }

    const vb = opt.thumb ? `${bx - 14} ${by - 46} ${bodyW + 28} ${bodyH + 62}` : `0 0 ${W} ${H}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${opt.width || W}" height="${opt.height || H}">${p.join('')}</svg>`;
  },

  /* ---------- 部件 ---------- */
  defs(S, sky) {
    return `<defs>
      <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${sky.top}"/>
        <stop offset="72%" stop-color="${sky.bot}"/>
        <stop offset="100%" stop-color="${sky.bot}"/>
      </linearGradient>
      <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="6" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <linearGradient id="glassG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${this.shade(sky.glow, -18)}"/>
        <stop offset="100%" stop-color="${this.shade(sky.glow, -40)}"/>
      </linearGradient>
    </defs>`;
  },

  skyline(W, H, groundY, sky) {
    let g = `<g opacity=".5">`;
    const b = [
      [0, 60, 70, 0.55],
      [58, 92, 52, 0.4],
      [104, 44, 84, 0.62],
      [180, 108, 60, 0.34],
      [232, 70, 96, 0.5],
      [320, 124, 54, 0.3],
      [366, 52, 74, 0.58]
    ];
    b.forEach(([x, h, w, o]) => {
      g += `<rect x="${x}" y="${groundY - h}" width="${w}" height="${h}" fill="${sky.far}" opacity="${o}"/>`;
      // 零星窗户
      for (let i = 0; i < Math.floor(h / 16); i++) {
        g += `<rect x="${x + 5}" y="${groundY - h + 8 + i * 16}" width="4" height="6" fill="${sky.glow}" opacity="${sky.lit * 0.8}"/>`;
      }
    });
    g += `</g>`;
    return g;
  },

  body(bx, by, bodyW, bodyH, S, T, sky, floors, bays, floorH, bayW) {
    let g = `<g>`;
    // 主墙
    g += `<rect x="${bx}" y="${by}" width="${bodyW}" height="${bodyH}" fill="${S.wall || T.wall}"/>`;
    // 材质纹理
    g += this.texture(bx, by, bodyW, bodyH, S.type);
    // 楼层分隔线
    for (let f = 1; f < floors; f++) {
      const y = by + f * floorH;
      g += `<rect x="${bx}" y="${y - 3}" width="${bodyW}" height="3" fill="${S.trim || T.trim}" opacity=".55"/>`;
      g += `<rect x="${bx}" y="${y}" width="${bodyW}" height="1.5" fill="#fff" opacity=".14"/>`;
    }
    // 勒脚
    g += `<rect x="${bx}" y="${by + bodyH - 8}" width="${bodyW}" height="8" fill="${this.shade(S.trim || T.trim, -18)}" opacity=".7"/>`;
    // 侧墙阴影
    g += `<rect x="${bx + bodyW - 6}" y="${by}" width="6" height="${bodyH}" fill="#000" opacity=".1"/>`;
    g += `</g>`;
    return g;
  },

  texture(bx, by, bodyW, bodyH, type) {
    let g = `<g>`;
    if (type === 'palace' || type === 'shrine' || type === 'pavilion' || type === 'island') {
      // 仙宫云纹
      for (let i = 0; i < 8; i++) {
        const x = bx + 12 + (i * 47) % Math.max(1, bodyW - 24);
        const y = by + 18 + ((i * 31) % Math.max(1, bodyH - 36));
        g += `<path d="M ${x} ${y} Q ${x + 8} ${y - 5} ${x + 16} ${y} Q ${x + 8} ${y + 5} ${x} ${y}" fill="none" stroke="#fff" stroke-width="1" opacity=".12"/>`;
      }
      g += `<rect x="${bx + 3}" y="${by + 3}" width="${bodyW - 6}" height="${bodyH - 6}" fill="none" stroke="${this.shade('#8a7d6e', 18)}" stroke-width="1.4" opacity=".4"/>`;
    } else if (type === 'fortress') {
      // 关隘石墙
      for (let y = by + 6; y < by + bodyH; y += 9) {
        g += `<line x1="${bx}" y1="${y}" x2="${bx + bodyW}" y2="${y}" stroke="#000" stroke-width=".6" opacity=".12"/>`;
      }
      for (let y = by + 6, r = 0; y < by + bodyH; y += 9, r++) {
        const off = r % 2 ? 0 : 8;
        for (let x = bx + off; x < bx + bodyW; x += 16) {
          g += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 9}" stroke="#000" stroke-width=".6" opacity=".1"/>`;
        }
      }
    } else if (type === 'cave' || type === 'abyss') {
      // 洞府岩壁
      for (let i = 0; i < 12; i++) {
        const x = bx + ((i * 37) % Math.max(1, bodyW - 12));
        const y = by + ((i * 53) % Math.max(1, bodyH - 14));
        g += `<ellipse cx="${x}" cy="${y}" rx="${3 + (i % 4)}" ry="${2 + (i % 3)}" fill="#000" opacity=".06"/>`;
      }
    } else if (type === 'altar') {
      // 祭坛台基
      g += `<rect x="${bx}" y="${by + bodyH - 10}" width="${bodyW}" height="10" fill="${this.shade('#6a5a4a', -12)}" opacity=".5"/>`;
      for (let x = bx + 10; x < bx + bodyW; x += 20) {
        g += `<line x1="${x}" y1="${by}" x2="${x}" y2="${by + bodyH}" stroke="#000" stroke-width=".8" opacity=".1"/>`;
      }
    } else {
      // 默认斑驳
      for (let i = 0; i < 14; i++) {
        const x = bx + ((i * 37) % Math.max(1, bodyW - 12));
        const y = by + ((i * 53) % Math.max(1, bodyH - 14));
        g += `<ellipse cx="${x}" cy="${y}" rx="${3 + (i % 4)}" ry="${2 + (i % 3)}" fill="#000" opacity=".05"/>`;
      }
    }
    g += `</g>`;
    return g;
  },

  roof(bx, by, bodyW, kind, roofColor, sky, S, T) {
    const over = 10;
    const x = bx - over;
    const w = bodyW + over * 2;
    const h = 26;
    let g = `<g>`;
    if (kind === 'gable') {
      g += `<path d="M ${x} ${by} L ${bx + bodyW / 2} ${by - h * 1.5} L ${x + w} ${by} Z" fill="${roofColor}"/>`;
      g += `<path d="M ${x} ${by} L ${bx + bodyW / 2} ${by - h * 1.5} L ${bx + bodyW / 2} ${by} Z" fill="#000" opacity=".14"/>`;
    } else if (kind === 'hip') {
      g += `<path d="M ${x + w * 0.22} ${by} L ${bx + bodyW * 0.28} ${by - h} L ${bx + bodyW * 0.72} ${by - h} L ${x + w * 0.78} ${by} Z" fill="${roofColor}"/>`;
    } else if (kind === 'shed') {
      g += `<path d="M ${x} ${by - h * 0.5} L ${x + w} ${by} L ${x + w} ${by + 4} L ${x} ${by - h * 0.5 + 4} Z" fill="${roofColor}"/>`;
      // 支柱
      g += `<rect x="${bx + 4}" y="${by - 4}" width="3" height="${26}" fill="${this.shade(roofColor, -30)}"/>`;
      g += `<rect x="${bx + bodyW - 7}" y="${by - 4}" width="3" height="${26}" fill="${this.shade(roofColor, -30)}"/>`;
    } else if (kind === 'curved') {
      // 中式飞檐
      g += `<path d="M ${x - 4} ${by}
        Q ${bx + bodyW * 0.22} ${by - h * 0.7} ${bx + bodyW / 2} ${by - h * 1.25}
        Q ${bx + bodyW * 0.78} ${by - h * 0.7} ${x + w + 4} ${by}
        L ${x + w} ${by + 6} L ${x} ${by + 6} Z" fill="${roofColor}"/>`;
      g += `<path d="M ${x + 6} ${by - 2} Q ${bx + bodyW * 0.26} ${by - h * 0.62} ${bx + bodyW / 2} ${by - h * 1.12}
        Q ${bx + bodyW * 0.74} ${by - h * 0.62} ${x + w - 6} ${by - 2}" fill="none" stroke="#fff" stroke-width="1.4" opacity=".18"/>`;
    } else if (kind === 'arch') {
      g += `<path d="M ${x} ${by} A ${bodyW / 2 + over} ${h * 1.3} 0 0 1 ${x + w} ${by} Z" fill="${roofColor}"/>`;
    } else {
      // 平顶：女儿墙 + 压檐
      g += `<rect x="${x}" y="${by - 7}" width="${w}" height="7" fill="${roofColor}"/>`;
      g += `<rect x="${bx + 3}" y="${by - 15}" width="${bodyW - 6}" height="8" fill="${this.shade(roofColor, 12)}"/>`;
      g += `<rect x="${x}" y="${by - 7}" width="${w}" height="2" fill="#fff" opacity=".16"/>`;
    }
    g += `</g>`;
    return g;
  },

  openings(bx, by, bodyW, bodyH, S, T, sky, floors, bays, floorH, bayW) {
    let g = `<g>`;
    const trim = S.trim || T.trim;
    const inner = bx + 15;
    const winW = bayW - 12;
    const winH = 26;
    const doorBays = S.door === 'double' ? 2 : 1;

    for (let f = 0; f < floors; f++) {
      const fy = by + f * floorH + 14;
      for (let b = 0; b < bays; b++) {
        const wx = inner + b * bayW;
        // 底层中间留给门
        if (f === 0 && b >= Math.floor((bays - doorBays) / 2) && b < Math.floor((bays - doorBays) / 2) + doorBays) {
          continue;
        }
        const lit = this.isLit(b, f, sky);
        g += this.window(x0(wx), fy, winW, winH, S.windows, trim, sky, lit);
      }
    }
    // 门
    const dBays = Math.floor((bays - doorBays) / 2);
    const dx = inner + dBays * bayW - 4;
    const dW = doorBays * bayW + 4;
    g += this.door(dx, by + bodyH - 40, dW, 40, S.door, trim, sky);

    // 门牌
    g += `<rect x="${dx + dW - 17}" y="${by + bodyH - 30}" width="11" height="15" fill="${this.shade(trim, -30)}" opacity=".85"/>`;
    g += `<rect x="${dx + dW - 15}" y="${by + bodyH - 28}" width="7" height="11" fill="${sky.glow}" opacity=".55"/>`;
    g += `</g>`;
    return g;
  },

  window(x, y, w, h, kind, trim, sky, lit) {
    const glassLit = lit ? sky.glow : '#3a3f45';
    const opa = lit ? 0.95 : 0.5;
    let g = `<g>`;
    if (kind === 'arch') {
      g += `<path d="M ${x} ${y + h} L ${x} ${y + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2} L ${x + w} ${y + h} Z" fill="${glassLit}" opacity="${opa}"/>`;
      g += `<path d="M ${x} ${y + h} L ${x} ${y + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2} L ${x + w} ${y + h}" fill="none" stroke="${trim}" stroke-width="2"/>`;
      g += `<line x1="${x + w / 2}" y1="${y + 6}" x2="${x + w / 2}" y2="${y + h}" stroke="${trim}" stroke-width="1.4" opacity=".8"/>`;
    } else if (kind === 'lattice') {
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${glassLit}" opacity="${opa}"/>`;
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${trim}" stroke-width="2"/>`;
      for (let i = 1; i < 4; i++) g += `<line x1="${x + (w / 4) * i}" y1="${y}" x2="${x + (w / 4) * i}" y2="${y + h}" stroke="${trim}" stroke-width="1"/>`;
      for (let i = 1; i < 3; i++) g += `<line x1="${x}" y1="${y + (h / 3) * i}" x2="${x + w}" y2="${y + (h / 3) * i}" stroke="${trim}" stroke-width="1"/>`;
    } else if (kind === 'barred') {
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#22262b" opacity=".62"/>`;
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${trim}" stroke-width="2"/>`;
      for (let i = 1; i < 4; i++) g += `<line x1="${x + (w / 4) * i}" y1="${y}" x2="${x + (w / 4) * i}" y2="${y + h}" stroke="${trim}" stroke-width="1.4"/>`;
    } else if (kind === 'shutter') {
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${glassLit}" opacity="${opa * 0.8}"/>`;
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${trim}" stroke-width="2"/>`;
      g += `<rect x="${x - 4}" y="${y - 1}" width="5" height="${h + 2}" fill="${this.shade(trim, 16)}"/>`;
      g += `<rect x="${x + w - 1}" y="${y - 1}" width="5" height="${h + 2}" fill="${this.shade(trim, 16)}"/>`;
      g += `<line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + h}" stroke="${trim}" stroke-width="1.2"/>`;
    } else {
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${glassLit}" opacity="${opa}"/>`;
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${trim}" stroke-width="2"/>`;
      g += `<line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + h}" stroke="${trim}" stroke-width="1.2"/>`;
      g += `<line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="${trim}" stroke-width="1.2"/>`;
    }
    // 窗框外描边
    g += `<rect x="${x - 1.5}" y="${y - 1.5}" width="${w + 3}" height="${h + 3}" fill="none" stroke="#000" stroke-width="1" opacity=".18"/>`;
    g += `</g>`;
    return g;
  },

  door(x, y, w, h, kind, trim, sky) {
    let g = `<g>`;
    if (kind === 'rolling') {
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${this.shade(trim, -26)}"/>`;
      for (let i = 0; i < 7; i++) g += `<line x1="${x}" y1="${y + 4 + i * 5}" x2="${x + w}" y2="${y + 4 + i * 5}" stroke="#fff" stroke-width="1" opacity=".12"/>`;
    } else if (kind === 'arch') {
      g += `<path d="M ${x} ${y + h} L ${x} ${y + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2} L ${x + w} ${y + h} Z" fill="${this.shade(trim, -32)}"/>`;
      g += `<path d="M ${x} ${y + h} L ${x} ${y + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2} L ${x + w} ${y + h}" fill="none" stroke="${trim}" stroke-width="2.2"/>`;
    } else if (kind === 'double') {
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${this.shade(trim, -30)}"/>`;
      g += `<rect x="${x + 2}" y="${y + 2}" width="${w / 2 - 3}" height="${h - 4}" fill="${this.shade(trim, -12)}" opacity=".7"/>`;
      g += `<rect x="${x + w / 2 + 1}" y="${y + 2}" width="${w / 2 - 3}" height="${h - 4}" fill="${this.shade(trim, -12)}" opacity=".7"/>`;
      g += `<circle cx="${x + w / 2 - 4}" cy="${y + h / 2}" r="1.8" fill="${sky.glow}" opacity=".7"/>`;
      g += `<circle cx="${x + w / 2 + 4}" cy="${y + h / 2}" r="1.8" fill="${sky.glow}" opacity=".7"/>`;
    } else {
      g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${this.shade(trim, -30)}"/>`;
      g += `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="${this.shade(trim, -14)}" opacity=".65"/>`;
      g += `<circle cx="${x + w - 7}" cy="${y + h / 2}" r="1.8" fill="${sky.glow}" opacity=".7"/>`;
    }
    g += `<rect x="${x - 2}" y="${y - 3}" width="${w + 4}" height="3" fill="${trim}" opacity=".9"/>`;
    g += `</g>`;
    return g;
  },

  sign(bx, by, bodyW, S, sky) {
    const style = S.signStyle || 'board';
    const text = String(S.sign).slice(0, 4);
    let g = `<g>`;
    if (style === 'lantern') {
      // 灯笼挂在门楣
      g += `<path d="M ${bx + bodyW / 2 - 30} ${by + 4} L ${bx + bodyW / 2 + 30} ${by + 4}" stroke="${sky.ink}" stroke-width="1.4" opacity=".6"/>`;
      for (let i = -1; i <= 1; i++) {
        const cx = bx + bodyW / 2 + i * 26;
        g += `<line x1="${cx}" y1="${by + 4}" x2="${cx}" y2="${by + 12}" stroke="${sky.ink}" stroke-width="1" opacity=".5"/>`;
        g += `<ellipse cx="${cx}" cy="${by + 19}" rx="7" ry="9" fill="#c0392b" opacity=".92" filter="url(#glow)"/>`;
        g += `<line x1="${cx}" y1="${by + 10}" x2="${cx}" y2="${by + 28}" stroke="#7d2b20" stroke-width=".8" opacity=".5"/>`;
      }
    } else if (style === 'neon') {
      const cy = by + 8;
      g += `<rect x="${bx + bodyW / 2 - 46}" y="${cy}" width="92" height="22" rx="3" fill="none" stroke="#e874b4" stroke-width="2" opacity=".9" filter="url(#glow)"/>`;
      g += `<text x="${bx + bodyW / 2}" y="${cy + 16}" text-anchor="middle" font-size="14" fill="#f7b7d8" font-family="'Songti SC',serif" filter="url(#glow)">${esc(text)}</text>`;
    } else if (style === 'painted') {
      // 墙上刷字
      g += `<text x="${bx + bodyW / 2}" y="${by + 22}" text-anchor="middle" font-size="18" fill="${this.shade('#b03a2e', 10)}" opacity=".72" font-family="'Songti SC','Noto Serif SC',serif" letter-spacing="4">${esc(text)}</text>`;
    } else if (style === 'hanging') {
      // 竖挑出的招牌
      g += `<rect x="${bx + bodyW - 20}" y="${by + 8}" width="20" height="52" rx="2" fill="#2f3a34" opacity=".92"/>`;
      g += `<rect x="${bx + bodyW - 18}" y="${by + 10}" width="16" height="48" rx="1" fill="none" stroke="${sky.glow}" stroke-width="1" opacity=".5"/>`;
      const chars = String(text).split('');
      chars.forEach((c, i) => {
        g += `<text x="${bx + bodyW - 10}" y="${by + 26 + i * 16}" text-anchor="middle" font-size="13" fill="${sky.glow}" opacity=".9" font-family="'Songti SC',serif">${esc(c)}</text>`;
      });
      g += `<line x1="${bx + bodyW - 10}" y1="${by + 8}" x2="${bx + bodyW - 10}" y2="${by + 2}" stroke="${sky.ink}" stroke-width="1.4"/>`;
    } else {
      // 横匾
      g += `<rect x="${bx + bodyW / 2 - 40}" y="${by + 6}" width="80" height="24" rx="2" fill="#2b2723" opacity=".93"/>`;
      g += `<rect x="${bx + bodyW / 2 - 37}" y="${by + 9}" width="74" height="18" rx="1" fill="none" stroke="${sky.glow}" stroke-width="1" opacity=".55"/>`;
      g += `<text x="${bx + bodyW / 2}" y="${by + 23}" text-anchor="middle" font-size="14" fill="${sky.glow}" opacity=".95" font-family="'Songti SC','Noto Serif SC',serif" letter-spacing="2">${esc(text)}</text>`;
    }
    g += `</g>`;
    return g;
  },

  neon(bx, by, bodyW, S, sky) {
    return this.sign(bx, by, bodyW, Object.assign({}, S, { signStyle: 'neon' }), sky);
  },

  awning(bx, groundY, bodyW, S, sky) {
    const w = bodyW * 0.5;
    const x = bx + bodyW / 2 - w / 2;
    const y = groundY - 42;
    let g = `<g>`;
    for (let i = 0; i < 8; i++) {
      g += `<rect x="${x + (w / 8) * i}" y="${y}" width="${w / 8}" height="12" fill="${i % 2 ? '#a63a2a' : '#efe6d6'}" opacity=".88"/>`;
    }
    g += `<path d="M ${x} ${y + 12} L ${x + 6} ${y + 19} L ${x + w - 6} ${y + 19} L ${x + w} ${y + 12} Z" fill="#efe6d6" opacity=".8"/>`;
    g += `</g>`;
    return g;
  },

  balcony(bx, by, bodyW, bodyH, floorH, S, sky) {
    const y = by + floorH * 2 + 12;
    const w = bodyW * 0.42;
    const x = bx + bodyW * 0.12;
    let g = `<g>`;
    g += `<rect x="${x}" y="${y}" width="${w}" height="4" fill="${this.shade(S.trim || '#7d6a5e', 8)}"/>`;
    for (let i = 0; i <= 8; i++) {
      g += `<line x1="${x + (w / 8) * i}" y1="${y}" x2="${x + (w / 8) * i}" y2="${y - 14}" stroke="${this.shade(S.trim || '#7d6a5e', -10)}" stroke-width="1.2"/>`;
    }
    g += `<line x1="${x}" y1="${y - 14}" x2="${x + w}" y2="${y - 14}" stroke="${this.shade(S.trim || '#7d6a5e', -10)}" stroke-width="1.6"/>`;
    g += `</g>`;
    return g;
  },

  stairs(cx, groundY, S, sky) {
    let g = `<g>`;
    for (let i = 0; i < 3; i++) {
      g += `<rect x="${cx - 24 + i * 3}" y="${groundY - 6 - i * 5}" width="${48 - i * 6}" height="5" fill="${this.shade(S.trim || '#7d6a5e', 20)}" opacity=".8"/>`;
    }
    g += `</g>`;
    return g;
  },

  crates(x, groundY, sky) {
    let g = `<g>`;
    g += `<rect x="${x}" y="${groundY - 20}" width="26" height="20" rx="1" fill="#8a6a45"/>`;
    g += `<rect x="${x + 6}" y="${groundY - 36}" width="22" height="16" rx="1" fill="#96754d"/>`;
    g += `<rect x="${x + 2}" y="${groundY - 18}" width="22" height="1.4" fill="#000" opacity=".2"/>`;
    g += `<rect x="${x + 8}" y="${groundY - 34}" width="18" height="1.4" fill="#000" opacity=".2"/>`;
    g += `</g>`;
    return g;
  },

  lanterns(bx, by, bodyW, bodyH, sky) {
    let g = `<g>`;
    const y = by + bodyH - 52;
    for (let i = 0; i < 2; i++) {
      const cx = bx + bodyW * (0.18 + i * 0.64);
      g += `<line x1="${cx}" y1="${y - 26}" x2="${cx}" y2="${y - 8}" stroke="${sky.ink}" stroke-width="1" opacity=".5"/>`;
      g += `<ellipse cx="${cx}" cy="${y}" rx="6.5" ry="8.5" fill="#c0392b" opacity=".9" filter="url(#glow)"/>`;
    }
    g += `</g>`;
    return g;
  },

  chimney(x, by, sky, roofColor) {
    return `<g>
      <rect x="${x}" y="${by - 30}" width="13" height="34" fill="${this.shade(roofColor, -12)}"/>
      <rect x="${x - 2}" y="${by - 34}" width="17" height="5" fill="${this.shade(roofColor, -24)}"/>
    </g>`;
  },

  watertank(x, by, sky, roofColor) {
    return `<g>
      <rect x="${x}" y="${by - 34}" width="30" height="20" rx="3" fill="${this.shade(roofColor, 6)}"/>
      <path d="M ${x + 3} ${by - 34} Q ${x + 15} ${by - 44} ${x + 27} ${by - 34} Z" fill="${this.shade(roofColor, -16)}"/>
      <line x1="${x + 7}" y1="${by - 14}" x2="${x + 7}" y2="${by}" stroke="${this.shade(roofColor, -30)}" stroke-width="2"/>
      <line x1="${x + 23}" y1="${by - 14}" x2="${x + 23}" y2="${by}" stroke="${this.shade(roofColor, -30)}" stroke-width="2"/>
    </g>`;
  },

  flagpole(x, by, sky) {
    return `<g>
      <line x1="${x}" y1="${by}" x2="${x}" y2="${by - 46}" stroke="${sky.ink}" stroke-width="1.6" opacity=".7"/>
      <path d="M ${x} ${by - 46} L ${x + 20} ${by - 41} L ${x} ${by - 35} Z" fill="#a63a2a" opacity=".85"/>
    </g>`;
  },

  wires(W, sky) {
    return `<g opacity=".45" stroke="${sky.ink}" fill="none">
      <path d="M -10 54 Q ${W * 0.3} 78 ${W * 0.52} 52 Q ${W * 0.78} 30 ${W + 10} 58" stroke-width="1.1"/>
      <path d="M -10 68 Q ${W * 0.34} 92 ${W * 0.58} 66 Q ${W * 0.82} 44 ${W + 10} 72" stroke-width="1"/>
    </g>`;
  },

  /* ---------- 工具 ---------- */
  isLit(b, f, sky) {
    if (!sky.lit) return false;
    // 伪随机：位置固定，每次渲染一致
    const h = Math.sin((b + 1) * 12.9898 + (f + 1) * 78.233) * 43758.5453;
    const r = h - Math.floor(h);
    return r < sky.lit;
  },
  clampI(v, a, b) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return a;
    return n < a ? a : n > b ? b : n;
  },
  shade(hex, amt) {
    const h = String(hex || '#888888').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const num = parseInt(full.slice(0, 6), 16);
    if (!Number.isFinite(num)) return '#888888';
    let r = (num >> 16) & 255;
    let g = (num >> 8) & 255;
    let b = num & 255;
    r = Math.max(0, Math.min(255, r + amt));
    g = Math.max(0, Math.min(255, g + amt));
    b = Math.max(0, Math.min(255, b + amt));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  },

  /* ---------- 输出 ---------- */
  toDataURI(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  },
  /** 下载为 PNG（走 canvas 栅格化） */
  downloadPNG(svg, filename, scale) {
    scale = scale || 2;
    const uri = this.toDataURI(svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = (img.width || 440) * scale;
      c.height = (img.height || 340) * scale;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }, 'image/png');
    };
    img.src = uri;
  },
  downloadSVG(svg, filename) {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
};

function x0(v) {
  return Math.round(v);
}
