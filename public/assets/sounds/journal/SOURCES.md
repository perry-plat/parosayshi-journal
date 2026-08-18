# Journal sound sources

The shipped clips are edited derivatives of this CC0 recording from Freesound:

- All regular keys, space, backspace, and return: “Mechanical Keyboard Typing (Treble Version)” by stu556 — https://freesound.org/s/450282/
- Original keyboard: Leopold FC660M with Cherry MX Brown switches.

Processing: isolated seven individual physical strikes, converted to mono PCM, edge-faded, and peak-normalized for restrained interface playback. The short switch transient and keycap clack are intentionally preserved.

## Highlighter

The highlighter sounds are edited derivatives of two CC0 recordings by Joseph SARDIN / BigSoundBank (LaSonotheque):

- Drawing: “Marqueur, feutre indélébile” — https://lasonotheque.org/marqueur-feutre-indelebile-s0220.html
- Opening and closing: “Pen cap” — https://bigsoundbank.com/pen-cap-s0054.html

Processing: `highlighter-draw-loop.wav` uses a stable continuous-contact passage from the original 52-second marker recording. Three subtly rate- and EQ-varied passes are crossfaded into a 5.13-second mono 44.1 kHz PCM contact bed, with low handling rumble filtered and short edge fades. One Web Audio contact voice is prepared on pointer contact. The live gesture is interpreted from speed, pressure, acceleration, and direction change: slow passes stay darker and weightier, quick sweeps become lighter and brighter, and curves expose slightly more friction. A pause fades the contact voice after 115 ms, and pointer release adds a 130 ms release. The sample is never duration-stretched. The opening and closing clips remain separately gain-matched cap transients.
