/**
 * F1 23 setup knowledge for the engineer, so setup advice comes from a reference instead of
 * the model's general intuition. Two parts: what each setting does, and symptom -> change.
 *
 * Sources (read 2026-11-08): F1Laps "F1 car setups explained" (F1 22 ranges and effects),
 * EarlyGame "F1 23: Setups explained", RacingGames.gg F1 23 preview (F1 23 ranges, braking
 * model), Solox F1 23 setup database (typical values per track). Where sources disagree the
 * entry says so; `confidence` is how much the sources and basic vehicle dynamics agree.
 * Ranges are from the pre-release preview and the game's own telemetry; the garage screen
 * is the authority if they differ.
 */

export type Confidence = 'high' | 'medium' | 'low'

export interface SettingInfo {
  setting: string
  /** Name in the setup packet / get_setup. */
  field: string
  range: string
  raise: string
  lower: string
  notes?: string
}

export const SETTINGS: SettingInfo[] = [
  {
    setting: 'Front wing',
    field: 'frontWing',
    range: '0-50',
    raise:
      'More front downforce: sharper turn-in, less understeer, especially in medium/fast corners. More drag (small).',
    lower: 'Less front grip, more understeer, a touch more top speed.',
    notes:
      'The main balance tool. Front a few clicks above rear is common. Too much front makes the rear nervous on entry and over kerbs.',
  },
  {
    setting: 'Rear wing',
    field: 'rearWing',
    range: '0-50',
    raise:
      'More rear downforce: more stable rear in fast corners, better traction, less oversteer. Costs the most top speed of any setting.',
    lower: 'More top speed, freer rear, more oversteer in fast corners.',
    notes: 'Set for the track first (Monza ~7-9, Monaco 50), then balance with the front wing.',
  },
  {
    setting: 'Differential on throttle',
    field: 'onThrottle',
    range: '50-100% (F1 22 range; check the garage)',
    raise:
      'More locked under power: better drive in a straight line, but more understeer on exit and more snap/wheelspin risk in slow corners.',
    lower:
      'More open: smoother, easier traction out of slow corners, car rotates more on exit, inside rear can spin up if very low.',
    notes: 'Common range 50-70%. Sources agree lower is easier to drive out of slow corners.',
  },
  {
    setting: 'Differential off throttle',
    field: 'offThrottle',
    range: '50-100% (F1 22 range; check the garage)',
    raise:
      'More locked off throttle: more stable on entry and under braking, less rotation, less oversteer on entry.',
    lower: 'More rotation on entry (lift-off oversteer), more responsive, gentler on tyres.',
    notes: 'Common range 50-60%. Above 60% rarely helps except in the wet.',
  },
  {
    setting: 'Front camber',
    field: 'frontCamber',
    range: '-3.50 to -2.50',
    raise:
      'Toward -2.50 (less negative): better straight-line contact and braking, less cornering grip, kinder to tyres.',
    lower:
      'Toward -3.50 (more negative): more cornering grip, more tyre wear and heat on the inner edge.',
  },
  {
    setting: 'Rear camber',
    field: 'rearCamber',
    range: '-2.00 to -1.00',
    raise:
      'Toward -1.00: better traction out of slow corners, kinder to rear tyres, a little less rear grip mid-corner.',
    lower: 'Toward -2.00: more rear grip mid-corner, worse traction, rear less stable over kerbs.',
  },
  {
    setting: 'Front toe (out)',
    field: 'frontToe',
    range: '0.00-0.10 (F1 23), was 0.05-0.15',
    raise:
      'Sharper initial turn-in, but more tyre wear and drag, and can push into mid-corner understeer.',
    lower: 'Lazier turn-in, less wear, more straight-line speed.',
  },
  {
    setting: 'Rear toe (in)',
    field: 'rearToe',
    range: '0.10-0.30 (F1 23), was 0.20-0.50',
    raise:
      'More rear stability under braking and acceleration, easier to put power down; more wear and drag, a bit of understeer.',
    lower: 'Freer rear, more rotation, less wear; less stable in fast corners.',
  },
  {
    setting: 'Front suspension',
    field: 'frontSuspension',
    range: '1-41 (F1 23)',
    raise: 'Stiffer front: more responsive, better aero platform; harsher over bumps and kerbs.',
    lower:
      'Softer front: rides kerbs and bumps better, more mechanical grip; lazier and slower on straights.',
    notes: 'Fast drivers mostly run the front stiff (around 25-41).',
  },
  {
    setting: 'Rear suspension',
    field: 'rearSuspension',
    range: '1-41 (F1 23)',
    raise: 'Stiffer rear: sharper, but less traction and more oversteer in fast corners.',
    lower: 'Softer rear: better traction and kerb riding, more stable on exit.',
    notes: 'Fast drivers mostly run the rear soft (around 6-16).',
  },
  {
    setting: 'Front anti-roll bar',
    field: 'frontAntiRollBar',
    range: '1-21 (F1 23)',
    raise: 'Stiffer: quicker direction changes and response.',
    lower: 'Softer: more stable and forgiving.',
    notes:
      'Sources disagree on balance: one says stiffer front gives understeer (normal vehicle dynamics), another frames it only as sharper response. Treat as low confidence for balance; test it.',
  },
  {
    setting: 'Rear anti-roll bar',
    field: 'rearAntiRollBar',
    range: '1-21 (F1 23)',
    raise:
      'Stiffer rear: more rotation, more oversteer especially in fast corners, worse over kerbs.',
    lower: 'Softer rear: more stable rear, more understeer, better traction.',
    notes: 'Fast drivers usually run it low (1-6).',
  },
  {
    setting: 'Front ride height',
    field: 'frontSuspensionHeight',
    range: 'about 30-50 in the preview; real setups use ~24-37',
    raise: 'Less downforce and front grip, safer over kerbs and bumps.',
    lower: 'More downforce and front grip on entry; bottoming out risk (sparks, sudden grip loss).',
  },
  {
    setting: 'Rear ride height',
    field: 'rearSuspensionHeight',
    range: 'about 30-50 in the preview; real setups use ~30-42',
    raise:
      'More rake: more front-biased balance and rotation, less rear stability; less bottoming.',
    lower: 'More rear grip on exit and more top speed; bottoming risk.',
    notes:
      'Front vs rear height (rake) shifts the aero balance: rear higher than front = more front grip.',
  },
  {
    setting: 'Brake pressure',
    field: 'brakePressure',
    range: '80-100% (F1 23)',
    raise: 'More braking power, shorter stops; easier to lock up.',
    lower: 'Easier to modulate, fewer lock-ups; longer braking.',
    notes:
      'F1 23 locks up far more easily than F1 22. Drop pressure if he locks up a lot without ABS.',
  },
  {
    setting: 'Front brake bias',
    field: 'brakeBias',
    range: '50-70% front',
    raise: 'More to the front: stable under braking, but fronts lock and the car pushes on entry.',
    lower:
      'More to the rear: car rotates on entry, but rear lock-ups, which in F1 23 spin the car.',
    notes:
      'Typical 52-56%. Can also be changed on the wheel during a lap; raise it as tyres wear in a race.',
  },
  {
    setting: 'Tyre pressures',
    field: 'frontLeftTyrePressure etc.',
    range: 'front ~22.0-25.0 psi, rear ~20.0-23.0 psi (preview)',
    raise: 'Hotter tyres, more responsive, a little more top speed; overheat and wear faster.',
    lower: 'Cooler tyres, more stable grip over a stint, less wear.',
    notes:
      "Mainly a temperature tool: aim for the game's green window (roughly 90-100 C carcass). Sources disagree on whether lower or higher pressure gives more peak grip; use temperatures, not feel.",
  },
]

export interface Fix {
  symptom: string
  /** Words he might use, for matching. */
  keywords: string[]
  /** Try in this order, one at a time. */
  changes: { change: string; confidence: Confidence; why: string }[]
  checkFirst?: string
}

export const FIXES: Fix[] = [
  {
    symptom: "Understeer on corner entry (car won't turn in)",
    keywords: [
      'understeer',
      "won't turn",
      'push',
      'pushing',
      'turn in',
      'turn-in',
      'entry',
      'front washes',
    ],
    checkFirst:
      'Is he braking too late or still hard on the brakes while turning? Front lock-ups look like understeer.',
    changes: [
      {
        change: 'Front wing +2 to +3',
        confidence: 'high',
        why: 'More front downforce, all sources agree.',
      },
      {
        change: 'Front brake bias -1% (if it happens under braking)',
        confidence: 'high',
        why: 'Less front lock-up and push on entry.',
      },
      {
        change: 'Differential off throttle -5%',
        confidence: 'medium',
        why: 'More open off throttle lets the car rotate on entry.',
      },
      {
        change: 'Front toe +0.01 to +0.02',
        confidence: 'medium',
        why: 'Sharper initial turn-in; costs some wear.',
      },
    ],
  },
  {
    symptom: 'Understeer mid-corner (runs wide at the apex)',
    keywords: ['understeer', 'mid corner', 'mid-corner', 'apex', 'runs wide', 'wide'],
    checkFirst:
      'Front tyre temperatures: overheated fronts understeer whatever the setup. Is he carrying too much entry speed?',
    changes: [
      {
        change: 'Front wing +2',
        confidence: 'high',
        why: 'More front grip in medium and fast corners.',
      },
      {
        change: 'Rear anti-roll bar +1 to +2 (stiffer)',
        confidence: 'medium',
        why: 'Shifts grip balance forward, more rotation.',
      },
      {
        change: 'Front camber more negative (-0.1)',
        confidence: 'medium',
        why: 'More front cornering grip, more inner-edge wear.',
      },
    ],
  },
  {
    symptom: 'Understeer on exit (pushes wide on throttle)',
    keywords: ['understeer', 'exit', 'on throttle', 'power', 'wide on exit'],
    changes: [
      {
        change: 'Differential on throttle -5%',
        confidence: 'high',
        why: 'Sources agree a more locked on-throttle diff adds exit understeer.',
      },
      {
        change: 'Rear wing -1 or front wing +1',
        confidence: 'medium',
        why: 'Moves aero balance forward.',
      },
    ],
  },
  {
    symptom: 'Oversteer on entry or under braking (rear steps out, rear locks)',
    keywords: ['oversteer', 'loose', 'rear', 'snap', 'braking', 'entry', 'rear locks', 'spin'],
    checkFirst:
      'Downshifting too early or trail-braking too hard? Rear lock-ups in F1 23 come mostly from rearward brake bias.',
    changes: [
      {
        change: 'Front brake bias +1 to +2%',
        confidence: 'high',
        why: 'Less rear braking, fewer rear lock-ups (F1 23 punishes rear lock-ups).',
      },
      {
        change: 'Differential off throttle +5%',
        confidence: 'high',
        why: 'More locked off throttle stabilises the rear on entry.',
      },
      { change: 'Rear toe +0.02', confidence: 'medium', why: 'More rear stability under braking.' },
      {
        change: 'Front wing -1 to -2',
        confidence: 'medium',
        why: 'Less front bite if the car is too pointy.',
      },
    ],
  },
  {
    symptom: 'Oversteer mid-corner in fast corners (rear unstable at speed)',
    keywords: ['oversteer', 'fast corner', 'high speed', 'rear unstable', 'loose', 'nervous'],
    changes: [
      {
        change: 'Rear wing +2',
        confidence: 'high',
        why: 'More rear downforce where it matters; costs top speed.',
      },
      {
        change: 'Rear anti-roll bar -1 to -2 (softer)',
        confidence: 'medium',
        why: 'Stiff rear bar is the classic fast-corner oversteer cause.',
      },
      {
        change: 'Rear suspension softer (-2 to -3)',
        confidence: 'medium',
        why: 'Stiff rear suspension gives fast-corner oversteer.',
      },
      {
        change: 'Rear ride height -1 (less rake)',
        confidence: 'medium',
        why: 'Moves aero balance rearward.',
      },
    ],
  },
  {
    symptom: 'Wheelspin or snap oversteer on exit of slow corners (traction)',
    keywords: [
      'wheelspin',
      'traction',
      'snap',
      'exit',
      'power oversteer',
      'spins up',
      'slow corner',
    ],
    checkFirst:
      'Throttle application: is he going 0-100% in one go? Short-shifting helps before any setup change.',
    changes: [
      {
        change: 'Differential on throttle -5%',
        confidence: 'high',
        why: 'More open diff makes traction out of slow corners easier (F1Laps, community consensus).',
      },
      {
        change: 'Rear camber toward -1.00 (+0.1 to +0.2)',
        confidence: 'high',
        why: 'Both sources: less rear camber, better slow-corner traction.',
      },
      {
        change: 'Rear suspension softer (-2)',
        confidence: 'medium',
        why: 'More mechanical grip at the rear.',
      },
      {
        change: 'Rear anti-roll bar softer (-1)',
        confidence: 'medium',
        why: 'More stable rear on exit.',
      },
      {
        change: 'Rear wing +1 to +2',
        confidence: 'medium',
        why: 'Helps traction in medium-speed exits; costs top speed.',
      },
    ],
  },
  {
    symptom: 'Unsettled over kerbs and bumps',
    keywords: ['kerb', 'kerbs', 'curb', 'bump', 'bumpy', 'bouncing', 'unsettled'],
    changes: [
      {
        change: 'Softer suspension (front and/or rear -2 to -4)',
        confidence: 'high',
        why: 'Soft suspension rides kerbs better, all sources agree.',
      },
      {
        change: 'Ride height +1 to +2',
        confidence: 'high',
        why: 'Stops the floor hitting the kerb.',
      },
      { change: 'Softer anti-roll bars', confidence: 'medium', why: 'Less weight transfer shock.' },
    ],
  },
  {
    symptom: 'Bottoming out (sparks, sudden grip loss at high speed or over crests)',
    keywords: ['bottoming', 'bottom out', 'sparks', 'scraping', 'floor', 'porpoising'],
    changes: [
      {
        change: 'Ride height +1 to +2 at the end that hits (usually rear)',
        confidence: 'high',
        why: 'Lower ride height is what causes it.',
      },
      {
        change: 'Stiffer suspension at that end (+2)',
        confidence: 'medium',
        why: 'Less travel under load.',
      },
    ],
  },
  {
    symptom: 'Slow on the straights',
    keywords: ['straight', 'top speed', 'slow on straights', 'drag', 'speed trap'],
    changes: [
      {
        change: 'Rear wing -2 (then rebalance front wing -1 to -2)',
        confidence: 'high',
        why: 'Rear wing is the biggest drag item.',
      },
      { change: 'Toe closer to minimum', confidence: 'medium', why: 'Toe adds drag and scrub.' },
      {
        change: 'Lower ride height (-1)',
        confidence: 'medium',
        why: 'Less drag, but watch for bottoming.',
      },
    ],
  },
  {
    symptom: 'Front lock-ups',
    keywords: ['lock', 'locking', 'lock up', 'lockup', 'flat spot', 'front lock'],
    changes: [
      { change: 'Front brake bias -1 to -2%', confidence: 'high', why: 'Less front braking.' },
      {
        change: 'Brake pressure -5%',
        confidence: 'high',
        why: 'Easier to modulate; F1 23 locks up easily at 100%.',
      },
    ],
  },
  {
    symptom: 'Tyres overheating or wearing fast',
    keywords: [
      'overheat',
      'overheating',
      'hot',
      'wear',
      'degradation',
      'deg',
      'tyres dying',
      'tyres gone',
    ],
    checkFirst:
      'Which axle, and is it the surface (sliding: driving style) or the carcass (setup)? Rear overheating on exit is often wheelspin.',
    changes: [
      {
        change: 'Tyre pressure -0.2 to -0.4 psi on the hot axle',
        confidence: 'high',
        why: 'Lower pressure, lower temperature, all sources agree.',
      },
      {
        change: 'Camber less negative on that axle (+0.1)',
        confidence: 'medium',
        why: 'Spreads load, less inner-edge heat.',
      },
      { change: 'Toe closer to minimum', confidence: 'medium', why: 'Less scrub.' },
      {
        change: 'Rear: differential on throttle -5%',
        confidence: 'medium',
        why: 'Less rear wheelspin and sliding.',
      },
    ],
  },
  {
    symptom: 'Tyres too cold (no grip, below the green window)',
    keywords: ['cold', 'no grip', 'temperatures low', "won't switch on"],
    changes: [
      {
        change: 'Tyre pressure +0.2 to +0.4 psi',
        confidence: 'high',
        why: 'Higher pressure builds temperature.',
      },
      {
        change: 'Camber more negative (-0.1)',
        confidence: 'medium',
        why: 'More load on the inner edge, more heat.',
      },
    ],
  },
]

const METHOD = [
  'One change at a time (or one pair that belongs together, e.g. front and rear wing for balance), so the data can say what it did.',
  'Start with the highest-confidence change for the symptom; small steps (1-3 clicks, 1-5%).',
  'Ask which phase of the corner (entry, mid, exit) and which corners (slow or fast) before choosing: the fixes differ.',
  'Check driving technique first when the guide says so.',
  'After the change, at least 2-3 clean laps on the same tyres, then compare with get_setup_trial. Undo it if it is not better.',
]

/** Guide entries for a symptom (or everything), for the get_setup_guide tool. */
type Balance = 'under' | 'over'
type Phase = 'entry' | 'mid' | 'exit'

/** The handling balance and corner phase a description is about, from how drivers say it. */
function classify(text: string): { balance: Balance | null; phase: Phase | null } {
  const t = text.toLowerCase()
  const over =
    /oversteer|loose|rear (steps|slides|kicks|goes|snaps)|snap|spin|wheelspin|traction|tail/.test(t)
  const under =
    /understeer|won'?t turn|push(es|ing)? wide|runs? wide|front (washes|slides)|no front/.test(t)
  const balance = over && !under ? 'over' : under && !over ? 'under' : null
  const phase = /exit|on (the )?throttle|on power|out of|accelerat|traction|wheelspin/.test(t)
    ? 'exit'
    : /entry|turn[- ]?in|braking|under brakes|into the corner/.test(t)
      ? 'entry'
      : /mid|apex|fast corner|high speed/.test(t)
        ? 'mid'
        : null
  return { balance, phase }
}

export function setupGuide(symptom?: string) {
  if (!symptom) return { method: METHOD, settings: SETTINGS, fixes: FIXES.map((f) => f.symptom) }
  const q = symptom.toLowerCase()
  const want = classify(q)
  const scored = FIXES.map((f) => {
    const has = classify(f.symptom)
    // An oversteer complaint never gets understeer fixes, and the other way round.
    if (want.balance && has.balance && want.balance !== has.balance) return { f, score: 0 }
    return {
      f,
      score:
        f.keywords.filter((k) => q.includes(k)).length +
        (q.includes(f.symptom.toLowerCase()) ? 3 : 0) +
        (want.balance && want.balance === has.balance ? 2 : 0) +
        (want.phase && want.phase === has.phase ? 3 : 0),
    }
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  // Top three, plus anything tied with the third so a good match is never cut off.
  const cut = scored[2]?.score ?? 0
  return {
    method: METHOD,
    matches: scored.filter((x, i) => i < 3 || x.score >= cut).map((x) => x.f),
    ...(scored.length
      ? {}
      : { note: 'No direct match; all symptoms listed.', symptoms: FIXES.map((f) => f.symptom) }),
  }
}
