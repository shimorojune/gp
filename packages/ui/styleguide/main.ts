// Living style guide: renders every token and component from @gp/ui.
import {
  animateWaveform,
  banner,
  bindTabs,
  button,
  callout,
  card,
  color,
  contrastOf,
  delta,
  driverStrip,
  elevation,
  emptyState,
  errorState,
  field,
  gap,
  ghostNumber,
  inputs,
  lapTime,
  list,
  motion,
  overlay,
  pill,
  positionTab,
  ptt,
  radioCard,
  radius,
  raw,
  sectors,
  space,
  stat,
  statusDot,
  tabPanel,
  table,
  tabs,
  teamBar,
  teamColors,
  toast,
  tower,
  type,
  tyre,
} from '../src/index.ts'

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

function swatch(name: string, value: string, on: string = color.surface, group = 'color'): string {
  const ratio = value.startsWith('#') ? contrastOf(value, on).toFixed(1) : ''
  return `<div class="sg-swatch"><div class="chip" style="background:${value};color:${
    contrastOf('#ffffff', value.startsWith('#') ? value : '#000') > 4.5 ? '#fff' : '#0e1013'
  }">${ratio ? `${ratio}:1` : ''}</div><div class="meta">${name}<br><code>--gp-${group}-${kebab(name)}</code><br><code>${value}</code></div></div>`
}

const sec = (id: string, title: string, lead: string, body: string) =>
  `<section class="sg-sec" id="${id}"><h2 class="gp-heading">${title}</h2><p class="lead">${lead}</p>${body}</section>`
const h3 = (t: string) => `<h3 class="gp-label sg-h3">${t}</h3>`

// ---------- Foundations ----------

const pick = (keys: string[]) =>
  keys.map((k) => swatch(k, (color as Record<string, string>)[k]!)).join('')

const colours = sec(
  'color',
  'Colour',
  'Graphite from the app icon, white text, one red. Ratios on each chip are contrast against the surface colour. Timing colours mean what they mean on F1 timing screens and are used only for timing data.',
  `${h3('Surfaces and text')}<div class="sg-grid">${pick([
    'bg',
    'surface',
    'surfaceRaised',
    'surfaceSunken',
    'surfaceHover',
    'border',
    'borderStrong',
    'text',
    'textMuted',
    'textFaint',
  ])}</div>
  ${h3('Accent (red, used sparingly: primary action, live, PTT, your row)')}<div class="sg-grid">${pick(
    ['accent', 'accentHover', 'accentText', 'accentSubtle', 'focusRing'],
  )}</div>
  ${h3('Status')}<div class="sg-grid">${pick(['good', 'warn', 'bad', 'neutral'])}</div>
  ${h3('Timing')}<div class="sg-grid">${pick([
    'timingOverall',
    'timingPersonal',
    'timingSlower',
    'timingInvalid',
    'timingNone',
    'deltaGain',
    'deltaLoss',
  ])}</div>
  ${h3('Broadcast')}<div class="sg-grid">${pick(['nameBar', 'nameBarText', 'bannerFastest', 'bannerFastestBg'])}</div>
  ${h3('Data colours: tyres and teams (never used as UI accents)')}<div class="sg-grid">${pick([
    'tyreSoft',
    'tyreMedium',
    'tyreHard',
    'tyreInter',
    'tyreWet',
  ])}${Object.entries(teamColors)
    .map(([id, c]) =>
      swatch(`team ${id}`, c, color.surface, 'team').replace(
        `--gp-team-team-${id}`,
        `--gp-team-${id}`,
      ),
    )
    .join('')}</div>`,
)

const typeRows = Object.entries(type)
  .map(([k, [size, line]]) => {
    const num = k.startsWith('num')
    const sample = num
      ? `<span class="gp-num gp-italic" style="font-size:${size};line-height:${line};font-weight:700">1:31.874 +2.315</span>`
      : `<span style="font-size:${size};line-height:${line};font-family:${
          ['display', 'heading', 'title'].includes(k) ? 'var(--gp-font-display)' : 'inherit'
        };font-weight:${['display', 'heading', 'title'].includes(k) ? 600 : 400}">${
          k === 'caption'
            ? 'SECTOR 2 · LAP 7/58'
            : 'Gap to Leclerc is 0.8, he is struggling on the hards.'
        }</span>`
    return `<code>${kebab(k)} ${size}/${line}</code><div>${sample}</div>`
  })
  .join('')

const typography = sec(
  'type',
  'Type',
  'Two faces. GP Display (bundled Saira, OFL) for numbers, names, labels and the whole overlay: wide, with true italics and tabular figures so times never jitter. Inter for body text and forms. The display face is one token (--gp-font-display) and can be swapped for a licensed broadcast font.',
  `<div class="gp-card"><div class="sg-spec">${typeRows}</div></div>
  ${h3('Tabular figures: every digit is the same width')}
  <div class="gp-card" style="display:flex;gap:32px">
    <div class="gp-num gp-italic" style="font-size:34px;font-weight:700;line-height:1.15">1:11.111<br>1:08.808<br>0:59.000</div>
    <div class="gp-num" style="font-size:34px;font-weight:600;line-height:1.15">+0.111<br>−1.808<br>+12.000</div>
    <div style="font-family:var(--gp-font-display);font-size:30px;font-weight:800;font-style:italic;text-transform:uppercase;line-height:1.2">Hülkenberg<br>Pérez · Box box</div>
  </div>`,
)

const spacing = sec(
  'space',
  'Spacing, radius, elevation, motion',
  '4px grid. Radii stay small: broadcast strips use 4px, cards 10px, the overlay panel 14px. Depth is mostly surface steps; shadows are for floating things.',
  `${h3('Space')}<div class="gp-card"><div class="sg-spec">${Object.entries(space)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(
      ([k, v]) =>
        `<code>space-${String(k).replace('.', '-')} ${v}</code><div class="sg-space" style="width:${v}"></div>`,
    )
    .join('')}</div></div>
  ${h3('Radius')}<div class="sg-row">${Object.entries(radius)
    .map(
      ([k, v]) =>
        `<div class="sg-box"><div style="width:72px;height:48px;background:var(--gp-color-surface-raised);border:1px solid var(--gp-color-border-strong);border-radius:${v}"></div><code class="sg-code">${k} ${v}</code></div>`,
    )
    .join('')}</div>
  ${h3('Elevation')}<div class="sg-row">${Object.entries(elevation)
    .map(
      ([k, v]) =>
        `<div class="sg-box"><div style="width:120px;height:64px;background:var(--gp-color-surface-raised);border-radius:var(--gp-radius-lg);box-shadow:${v}"></div><code class="sg-code">elevation-${k}</code></div>`,
    )
    .join('')}</div>
  ${h3('Motion (click to play; instant when reduced motion is on)')}
  <div class="gp-card" style="display:flex;flex-direction:column;gap:10px">${(
    ['instant', 'fast', 'base', 'slow'] as const
  )
    .map(
      (k) =>
        `<div style="display:flex;gap:12px;align-items:center"><code class="sg-code" style="width:110px">${k} ${motion[k]}</code><div class="sg-track" data-motion><div class="sg-motion" style="transition:left ${motion[k]} ${motion.easeStandard}"></div></div></div>`,
    )
    .join('')}
    <div style="display:flex;gap:12px;align-items:center"><code class="sg-code" style="width:110px">overlay in/out</code><span class="sg-code">${overlay.fadeIn} in, hold ${overlay.holdMs / 1000}s, dim to ${overlay.dimOpacity}, ${overlay.fadeOut} out</span></div>
  </div>`,
)

// ---------- Components ----------

const btns = `<div class="sg-box">
  <div class="gp-btn-row">${button({ label: 'Start session', variant: 'primary' })}${button({ label: 'Notes' })}${button({ label: 'Cancel', variant: 'ghost' })}${button({ label: 'Delete note', variant: 'danger' })}${button({ label: 'Pinned', pressed: true })}${button({ label: 'Disabled', disabled: true })}</div>
  <div class="gp-btn-row">${button({ label: 'Small', size: 'sm' })}${button({ label: 'Medium' })}${button({ label: 'Large primary', variant: 'primary', size: 'lg' })}</div></div>`

const tabsDemo = `<div class="sg-box" style="gap:20px;width:100%">
  ${tabs({
    id: 'sg-mode',
    variant: 'segmented',
    selected: 'garage',
    label: 'Mode',
    tabs: [
      { id: 'garage', label: 'Garage' },
      { id: 'race', label: 'Race' },
      { id: 'review', label: 'Review' },
    ],
  })}
  <div style="width:100%">${tabs({
    id: 'sg-tabs',
    selected: 'setup',
    label: 'Garage',
    tabs: [
      { id: 'setup', label: 'Setup' },
      { id: 'strategy', label: 'Strategy' },
      { id: 'notes', label: 'Notes' },
    ],
  })}
  ${tabPanel('sg-tabs', 'setup', '<p class="gp-muted">Setup panel. Arrow keys move between tabs.</p>', true)}
  ${tabPanel('sg-tabs', 'strategy', '<p class="gp-muted">Strategy panel.</p>', false)}
  ${tabPanel('sg-tabs', 'notes', '<p class="gp-muted">Notes panel.</p>', false)}</div></div>`

const stats = card({
  title: 'Car',
  actions: pill('Live', 'good'),
  body: `<div class="gp-stat-grid">
    ${stat({ label: 'Position', value: 'P3', size: 'lg' })}
    ${stat({ label: 'Last lap', value: raw(lapTime({ ms: 72034, kind: 'personal' })), sub: raw(delta({ ms: -214 })) })}
    ${stat({ label: 'Best', value: raw(lapTime({ ms: 71820, kind: 'overall' })), sub: 'Lap 12' })}
    ${stat({ label: 'Speed', value: 287, unit: 'km/h' })}
    ${stat({ label: 'Fuel', value: '+1.4', unit: 'laps', sub: 'Lift and coast not needed' })}
    ${stat({ label: 'Tyre', value: raw(`${tyre('medium')} <span style="margin-left:4px">14</span>`), unit: 'laps', sub: 'Wear 31%' })}
  </div>`,
})

const timing = `<div class="sg-row" style="gap:24px">
  <div class="gp-card" style="display:flex;flex-direction:column;gap:8px;min-width:260px">
    <span class="gp-label">Lap time states</span>
    ${lapTime({ ms: 71820, kind: 'overall', size: 'md' })} ${lapTime({ ms: 72034, kind: 'personal', size: 'md' })}
    ${lapTime({ ms: 72411, kind: 'slower', size: 'md' })} ${lapTime({ ms: 70990, kind: 'invalid', size: 'md' })}
    ${lapTime({ ms: null, size: 'md' })}
    ${lapTime({ ms: 72034, size: 'xl', italic: true })}
  </div>
  <div class="gp-card" style="display:flex;flex-direction:column;gap:10px;min-width:220px">
    <span class="gp-label">Delta</span>
    <div class="sg-row">${delta({ ms: -214 })}${delta({ ms: 388 })}${delta({ ms: 2 })}</div>
    <div class="sg-row">${delta({ ms: -214, chip: true })}${delta({ ms: 388, chip: true })}${delta({ ms: 2, chip: true })}</div>
    <span class="gp-label" style="margin-top:8px">Sectors</span>
    ${sectors([{ kind: 'overall', ms: 23410 }, { kind: 'personal', ms: 25102 }, { kind: 'current' }], { times: true })}
    ${sectors([{ kind: 'slower', ms: 23710 }, { kind: 'invalid', ms: 25102 }, { kind: 'none' }], { times: true })}
  </div>
  <div class="gp-card" style="display:flex;flex-direction:column;gap:16px;min-width:300px">
    <span class="gp-label">Gap</span>
    ${gap({ side: 'ahead', name: 'Leclerc', gapMs: 812, trendMs: -184 })}
    ${gap({ side: 'behind', name: 'Norris', gapMs: 1430, trendMs: -95 })}
  </div></div>`

const status = `<div class="sg-row" style="gap:24px;align-items:center">
  ${statusDot('good', 'Telemetry live')}${statusDot('warn', 'Paused')}${statusDot('bad', 'No data')}${statusDot('neutral', 'Garage')}${statusDot('live', 'Recording', true)}${statusDot('off', 'Off')}
  ${pill('60 pkt/s')}${pill('Live', 'good')}${pill('v0.2.1')}
  ${tyre('soft')}${tyre('medium')}${tyre('hard')}${tyre('inter')}${tyre('wet')}</div>`

const fields = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
  ${field({ id: 'f1', label: 'Race goal', placeholder: 'e.g. top 5, clean race', hint: 'GP brings it up in the pre-race brief.' })}
  ${field({ id: 'f2', label: 'Category', kind: 'select', value: 'setup', options: ['driving', 'setup', 'radio', 'strategy', 'track'] })}
  ${field({ id: 'f3', label: 'Track', value: 'Silverstoen', error: 'No track called that. Did you mean Silverstone?' })}
  <div style="grid-column:1/-1">${field({ id: 'f4', label: "GP's read on you", kind: 'textarea', value: 'Brakes late into slow corners, gives time back on exit. Strong in the wet.' })}</div></div>`

const lists = `<div style="display:grid;grid-template-columns:1fr 1.4fr;gap:16px">
  ${card({
    title: 'Recent sessions',
    flush: true,
    body: list(
      [
        {
          title: 'Silverstone · Race',
          meta: 'Today · P2 · best 1:27.412',
          trailing: pill('P2'),
          current: true,
        },
        { title: 'Silverstone · Qualifying', meta: 'Today · P4', trailing: pill('P4') },
        {
          title: 'Monza · Time trial',
          meta: 'Yesterday · 1:21.004 PB',
          trailing: pill('PB', 'good'),
        },
      ],
      true,
    ),
  })}
  ${card({
    title: 'Laps',
    flush: true,
    body: table(
      [
        { label: 'Lap', cell: (r: Lap) => r.n, numeric: true },
        {
          label: 'Time',
          cell: (r: Lap) => raw(lapTime({ ms: r.ms, kind: r.kind })),
          numeric: true,
        },
        {
          label: 'Δ best',
          cell: (r: Lap) =>
            raw(
              r.kind === 'invalid'
                ? '<span class="gp-muted">deleted</span>'
                : r.d === 0
                  ? '<span class="gp-muted">best</span>'
                  : delta({ ms: r.d, arrow: false }),
            ),
          numeric: true,
        },
        { label: 'Tyre', cell: (r: Lap) => raw(tyre(r.t)) },
      ],
      [
        { n: 10, ms: 72411, kind: 'slower', d: 591, t: 'medium' },
        { n: 11, ms: 71820, kind: 'overall', d: 0, t: 'medium' },
        { n: 12, ms: 72034, kind: 'personal', d: 214, t: 'medium' },
        { n: 13, ms: 70990, kind: 'invalid', d: -830, t: 'medium' },
      ] as Lap[],
      { isMe: (r) => r.n === 11, caption: 'Lap times' },
    ),
  })}</div>`
type Lap = {
  n: number
  ms: number
  kind: 'overall' | 'personal' | 'slower' | 'invalid'
  d: number
  t: 'medium'
}

const feedback = `<div class="sg-row" style="gap:12px;align-items:center">
  ${ptt('idle')}${ptt('listening')}${ptt('thinking')}${ptt('speaking')}${ptt('off')}
  <span class="gp-spacer"></span>
  ${button({ label: 'Toast: saved', id: 't-good', size: 'sm' })}${button({ label: 'Toast: warn', id: 't-warn', size: 'sm' })}${button({ label: 'Toast: error', id: 't-bad', size: 'sm' })}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
  ${card({ body: emptyState({ title: 'No laps yet', body: 'Head out on track. Laps appear here as you complete them.', actions: button({ label: 'Open garage' }) }) })}
  ${card({ body: errorState({ title: 'No telemetry from F1 23', body: 'Check that UDP Telemetry is On and the port is 20777.', detail: 'listener: 0 packets in 30s on 0.0.0.0:20777', actions: button({ label: 'Retry', variant: 'primary' }) + button({ label: 'Open settings' }) }) })}</div>`

const components = sec(
  'components',
  'Core components',
  'App-window building blocks for Garage and Review. HTML-string builders in @gp/ui with matching .gp-* classes; text is always escaped.',
  `${h3('Buttons')}${btns}${h3('Tabs')}${tabsDemo}${h3('Card and stat readouts')}${stats}${h3('Lap time, delta, sectors, gap')}${timing}${h3('Status, pills, tyres')}${status}${h3('Fields')}${fields}${h3('List and table')}${lists}${h3('Push-to-talk, toast, empty and error')}${feedback}`,
)

// ---------- Broadcast ----------

const broadcast = sec(
  'broadcast',
  'Broadcast components',
  'Borrowed structure from TV timing graphics: a light name bar with a position tab and a slanted team-colour bar, a big italic number with a smaller reference time, sector ticks underneath. GP draws its own shapes; there are no logos.',
  `${h3('Driver strip')}<div class="sg-row">
    ${driverStrip({ position: 4, name: 'Tsunoda', teamId: 6, value: '+2.315', tone: 'slower', asideValue: '1:31.874', asideLabel: 'Alonso', sectors: ['overall', 'personal', 'slower'], sectorLabels: ['S1', 'S2', 'Sector 3'] })}
    ${driverStrip({ position: 1, name: 'You', teamId: 8, value: '1:29.412', tone: 'overall', asideValue: '−0.318', asideLabel: 'Fastest', flag: raw(tyre('soft')), sectors: ['overall', 'overall', 'personal'] })}
    ${driverStrip({ position: 3, name: 'You', teamId: 8, value: '−0.340', tone: 'gain', asideValue: '1:03.539', asideLabel: 'Norris', sectors: ['personal', 'current', 'none'] })}
  </div>
  ${h3('Timing tower, position tabs')}<div class="sg-row">
    ${tower({
      head: ['Lap', '7/58'],
      rows: [
        { position: 1, code: 'LEC', teamId: 1, gap: 'Leader' },
        { position: 2, code: 'VER', teamId: 2, gap: '+1.204', moved: 'up' },
        { position: 3, code: 'You', teamId: 8, gap: '+3.930', me: true },
        { position: 4, code: 'HAM', teamId: 0, gap: '+4.118' },
        { position: 5, code: 'NOR', teamId: 8, gap: '+6.502', fastest: true },
        { position: 6, code: 'ALO', teamId: 4, gap: 'Pit', pit: true },
      ],
    })}
    ${tower({
      head: ['Q2', '0:04'],
      rows: [
        { position: 9, code: 'RUS', teamId: 0, gap: '+1.080' },
        { position: 10, code: 'You', teamId: 8, gap: '+1.112', me: true },
        { position: 11, code: 'GAS', teamId: 5, gap: '+1.140' },
      ],
      note: 'Danger zone',
      liveMs: 89031,
    })}
    <div class="sg-box"><div class="sg-row" style="height:32px;align-items:stretch">${positionTab(1)}${positionTab(2, { light: true })}${positionTab(3, { moved: 'up' })}${positionTab(13, { moved: 'down' })}</div>
    <div class="sg-row" style="font-size:24px;gap:10px">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => teamBar(i)).join('')}</div></div>
  </div>
  ${h3('Radio card')}<div class="sg-row">
    <div class="sg-game" style="width:340px;aspect-ratio:auto;padding:16px">${radioCard({
      speaker: 'GP',
      lines: [
        { who: 'driver', text: 'Rears are going.' },
        { who: 'gp', text: 'Copy. Two more laps, then box. Manage the exits.' },
      ],
    })}</div>
    <div class="sg-game" style="width:340px;aspect-ratio:auto;padding:16px">${radioCard({ speaker: 'You', tag: 'Talking', lines: [{ who: 'driver', text: 'What is the gap behind?' }] })}</div>
  </div>
  ${h3('Banners')}<div class="sg-box">
    ${banner('fastest', 'Fastest lap', raw('You <span class="gp-num">1:29.412</span>'))}
    ${banner('warn', 'Safety car', 'Deployed · delta positive')}
    ${banner('accent', 'Box box', raw('Mediums · <span class="gp-num">2.4</span>s stop'))}
    ${banner('info', 'Personal best', raw('Monza <span class="gp-num">1:21.004</span>'))}
  </div>
  ${h3('Ghost number card, input cluster')}<div class="sg-row">
    ${ghostNumber(81, 8, `<div class="gp-card" style="width:320px;background:transparent;display:flex;gap:14px;align-items:center;padding:18px 16px;border-bottom:3px solid ${teamColors[8]}"><span class="gp-postab" style="font-size:30px">1</span><div><div style="font-family:var(--gp-font-display);font-size:14px;font-weight:600;text-transform:uppercase">Oscar</div><div style="font-family:var(--gp-font-display);font-size:24px;font-weight:800;font-style:italic;text-transform:uppercase;line-height:1">Piastri</div></div></div>`)}
    <div class="gp-card">${inputs({ speedKph: 287, throttle: 0.92, brake: 0.0 })} ${inputs({ speedKph: 112, throttle: 0, brake: 0.78 })}</div>
  </div>`,
)

// ---------- Overlay ----------

const overlaySec = sec(
  'overlay',
  'Overlay over the game',
  'What GP looks like while you drive. Much sparser than TV: the game already shows speed, gear and the full order, so GP shows only what it adds. Everything fades out after the hold time; nothing sits on screen when GP has nothing to say.',
  `<div class="sg-game gp-overlay" id="ov-mock">
    <div class="sg-ov" style="left:2.5%;top:4%">${tower({
      head: ['Lap', '23/58'],
      rows: [
        { position: 2, code: 'VER', teamId: 2, gap: '−1.204' },
        { position: 3, code: 'You', teamId: 8, gap: '', me: true },
        { position: 4, code: 'HAM', teamId: 0, gap: '+0.812' },
      ],
    })}</div>
    <div class="sg-ov" style="right:2.5%;top:30%">${radioCard({
      speaker: 'GP',
      lines: [
        { who: 'driver', text: 'Gap behind?' },
        { who: 'gp', text: 'Hamilton 0.8. He is on older mediums. Defend into Stowe.' },
      ],
    })}</div>
    <div class="sg-ov" style="left:2.5%;bottom:5%">${driverStrip({ position: 3, name: 'Lap 23', teamId: 8, value: '1:28.304', tone: 'personal', asideValue: '−0.214', asideLabel: 'vs best', sectors: ['personal', 'overall', 'current'] })}</div>
    <div class="sg-ov" style="right:2.5%;bottom:5%">${banner('fastest', 'Personal best', raw('Sector 2 <span class="gp-num">28.118</span>'))}</div>
  </div>
  <p class="sg-note">Layout rule: corners only, never the centre of the screen. Tower top-left with only the cars around you. Radio card right edge while GP or you are speaking, then it fades. Lap strip bottom-left. Banners for one-off events, 4 seconds. Input cluster stays off by default.</p>
  ${h3('Overlay panel and callout (plain style for a single spoken line)')}
  <div class="sg-game" style="aspect-ratio:auto;padding:24px;display:flex;gap:16px;align-items:flex-start">
    <div class="gp-overlay"><div class="gp-overlay-panel" data-state="in" style="width:440px">${callout('Box this lap. Mediums.')}</div></div>
    <div class="gp-overlay"><div class="gp-overlay-panel" data-state="in"><div class="gp-overlay-label">Gap ahead</div><div class="gp-overlay-readout">0.812</div></div></div>
    <div class="gp-overlay"><div class="gp-overlay-panel" data-state="dim"><div class="gp-overlay-label">Target</div><div class="gp-overlay-readout gp-italic">1:28.1</div></div></div>
  </div>`,
)

const principles = sec(
  'principles',
  'GP design system',
  'Pit wall calm, broadcast structure. Dark first. One red. Numbers are the hero and never jitter. The overlay says one thing at a time and gets out of the way. Full rules in docs/DESIGN.md.',
  `<div class="sg-row">${button({ label: 'Reduce motion: off', id: 'rm' })}</div>`,
)

$('#root').innerHTML =
  `<div class="sg-top"><strong style="font-family:var(--gp-font-display);font-style:italic;font-weight:800;font-size:18px">GP</strong><span class="gp-muted">Design system</span><span class="gp-spacer"></span><nav>${[
    'color',
    'type',
    'space',
    'components',
    'broadcast',
    'overlay',
  ]
    .map((id) => `<a href="#${id}">${id}</a>`)
    .join(
      '',
    )}</nav></div><div class="sg-wrap">${principles}${colours}${typography}${spacing}${components}${broadcast}${overlaySec}</div>`

// ---------- Behaviour ----------

bindTabs($('#sg-tabs'))
bindTabs($('#sg-mode'))
$('#t-good').onclick = () =>
  toast({
    kind: 'good',
    title: 'Note saved',
    body: 'GP will bring it up next time at Silverstone.',
  })
$('#t-warn').onclick = () =>
  toast({
    kind: 'warn',
    title: 'ElevenLabs credits low',
    body: '1,200 characters left this month.',
  })
$('#t-bad').onclick = () =>
  toast({
    kind: 'bad',
    title: 'Voice failed',
    body: 'Deepgram returned 401. Check the key in ~/Documents/GP/.env.',
  })
for (const track of document.querySelectorAll<HTMLElement>('[data-motion]')) {
  track.onclick = () => track.classList.toggle('go')
}
for (const card of document.querySelectorAll<HTMLElement>('.gp-radio[data-speaking="true"]'))
  animateWaveform(card)
const rm = $('#rm')
rm.onclick = () => {
  const on = document.documentElement.dataset.gpMotion !== 'reduce'
  if (on) document.documentElement.dataset.gpMotion = 'reduce'
  else delete document.documentElement.dataset.gpMotion
  rm.textContent = `Reduce motion: ${on ? 'on' : 'off'}`
}
