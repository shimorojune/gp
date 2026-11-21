// Living style guide for the base minimum: colour, type, space, and the radio card.
import {
  animateWaveform,
  color,
  contrastOf,
  radioCard,
  radius,
  space,
  teamColors,
  type,
} from '../src/index.ts'

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const sec = (id: string, title: string, lead: string, body: string) =>
  `<section class="sg-sec" id="${id}"><h2 class="gp-display sg-h2">${title}</h2><p class="lead">${lead}</p>${body}</section>`

const swatch = (name: string, value: string, varName: string) => {
  const solid = value.startsWith('#')
  const ratio = solid ? `${contrastOf(value, color.surface).toFixed(1)}:1` : ''
  return `<div class="sg-swatch"><div class="chip" style="background:${value}"></div><div class="meta"><b>${name}</b> <span>${ratio}</span><br><code>${varName}</code><br><code>${value}</code></div></div>`
}

const colours = sec(
  'color',
  'Colour',
  'Near-black, white, one red. Timing colours only on timing data. Team colours only as data (radio card, names). Ratios are contrast on the card surface.',
  `<div class="sg-grid">${Object.entries(color)
    .map(([k, v]) => swatch(k, v, `--gp-color-${kebab(k)}`))
    .join('')}</div>
  <h3 class="gp-label sg-h3">Team colours (F1 23 team id)</h3>
  <div class="sg-grid">${Object.entries(teamColors)
    .map(([k, v]) => swatch(`team ${k}`, v, `--gp-team-${k}`))
    .join('')}</div>`,
)

const typeSec = sec(
  'type',
  'Type',
  'Two faces. GP Display (bundled Saira, OFL, always expanded) for anything broadcast: names, numbers, labels, the radio card. Inter for plain UI text. The display face is one token and can be replaced locally by a font you own.',
  `<div class="sg-type">${Object.entries(type)
    .map(([k, [size, line]]) => {
      const sample =
        k === 'name'
          ? '<span style="font-weight:800;text-transform:uppercase">Piastri radio</span>'
          : k === 'number'
            ? '<span style="font-weight:800">81</span> <span style="font-weight:500;font-size:0.6em">1:28.304</span>'
            : k === 'quote'
              ? '<span style="font-weight:500;text-transform:uppercase">“Remember to use the drink”</span>'
              : k === 'caption'
                ? '<span class="gp-label" style="font-size:inherit">Lap 7/58 · Sector 2</span>'
                : `<span style="font-family:var(--gp-font-sans)">Gap to Leclerc is 0.8, he is struggling on the hards.</span>`
      return `<code>${k} ${size}/${line}</code><div class="gp-display" style="font-size:${size};line-height:${line}">${sample}</div>`
    })
    .join('')}</div>`,
)

const spacing = sec(
  'space',
  'Space and radius',
  '4px grid. Broadcast cards use 2px corners; app controls 6px.',
  `<div class="sg-type">${Object.entries(space)
    .map(
      ([k, v]) =>
        `<code>space-${k} ${v}</code><div style="height:10px;width:${v};background:var(--gp-color-accent)"></div>`,
    )
    .join('')}${Object.entries(radius)
    .map(
      ([k, v]) =>
        `<code>radius-${k} ${v}</code><div style="width:64px;height:40px;border:1px solid var(--gp-color-edge);background:var(--gp-color-surface);border-radius:${v}"></div>`,
    )
    .join('')}</div>`,
)

const cards = [
  radioCard({
    speaker: 'GP',
    number: 81,
    teamId: 8,
    lines: [
      { who: 'gp', text: 'Remember to use the drink' },
      { who: 'driver', text: 'I would if it was working' },
    ],
  }),
  radioCard({
    speaker: 'GP',
    number: 16,
    teamId: 1,
    lines: [
      { who: 'driver', text: 'Rears are gone' },
      { who: 'gp', text: 'Two more laps, then box. Mediums.' },
    ],
  }),
  radioCard({
    speaker: 'GP',
    number: 63,
    teamId: 0,
    lines: [{ who: 'gp', text: 'Hamilton 0.8 behind. Defend into Stowe.' }],
  }),
  radioCard({
    speaker: 'GP',
    number: 1,
    teamId: 2,
    speaking: false,
    lines: [
      { who: 'gp', text: 'Good lap. Purple sector two.' },
      { who: 'driver', text: 'Copy' },
    ],
  }),
]

const radio = sec(
  'radio',
  'Radio card',
  "The one broadcast component in the base set. Name in team colour over a white RADIO, big number on a stepped waveform, quotes in caps: GP's lines white on the left, yours in team colour on the right. Team colour comes from your car in the telemetry.",
  `<div class="sg-cards">${cards.join('')}</div>
  <h3 class="gp-label sg-h3">Over the game</h3>
  <div class="sg-game" id="ov-mock"><div class="sg-ov">${radioCard({
    speaker: 'GP',
    number: 3,
    teamId: 8,
    lines: [
      { who: 'driver', text: 'Gap behind?' },
      { who: 'gp', text: 'Hamilton 0.8. He is on older mediums. Defend into Stowe.' },
    ],
  })}</div></div>`,
)

$('#root').innerHTML =
  `<div class="sg-top"><strong class="gp-display" style="font-weight:800;font-size:18px">GP</strong><span class="gp-label">Design system · base</span></div><div class="sg-wrap">${colours}${typeSec}${spacing}${radio}</div>`

for (const card of document.querySelectorAll<HTMLElement>('.gp-radio')) {
  let t = Math.random() * 100
  animateWaveform(
    card,
    card.dataset.speaking === 'false'
      ? undefined
      : () => {
          t += 0.18
          return 0.35 + 0.35 * Math.abs(Math.sin(t)) + 0.2 * Math.random()
        },
  )
}
