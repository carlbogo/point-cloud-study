# MVP seis

Uuendatud 2. novembril 2026. Käivitamine ja import: [README](README.md).

- TypeScript Worker + D1; React + Vite.
- Päris kogumist imporditud 2 900 PNG-d: MNIST 900, Fashion-MNIST 1 000, CIFAR-10 1 000. MNISTi nullid jäetakse välja.
- Üks täisvoor: 21 pilti. Igast andmestikust 3/2/1/1 pilti raskustel 9/11/13/17.
- Sama lähtepildi variandid ühes voorus ei kordu. Esimesed kolm pilti on MNIST d=9. Kogu voor liigub raskustel 9 → 11 → 13 → 17; juhuslik järjekord on ainult sama raskusastme sees.
- MNIST: valikud 1–9. Hübriidrežiimis on Fashion samuti valikutega ja CIFAR-10 vabavastusega; teises režiimis on kõik valikutega. Tuntud sünonüümid aktsepteeritakse, tundmatud vabavastused jäävad käsitsi ülevaatuseks.
- Vabatahtlik joonistamine ning sündmuste ja ajamõõdikute salvestamine.
- Õige vastus alles pärast vastuse lukustamist; korraldaja eksport sisaldab piltide genereerimise metaandmeid.
- Kohalikus avalikus demos on Start over nupp; kutselingiga katse ei luba uut vooru ise alustada.
- Kohalik MNISTi eelvaade: 7 pilti. See on eraldi täisvoorust.
- Cloudflare Worker + D1 on avaldatud. Enne pärisandmete kogumist on veel vaja metoodika pilooti.

Raskusastmete allikas: [Khajuria et al. (2025), joonis 8](https://doi.org/10.1371/journal.pcbi.1012968). Jaotus 3–2–1–1 on meie protokoll. Artikli tulemused ei kinnita CIFAR-10 sama tajutavat raskust.

Uuendus 3. novembril 2026: lõpetamisvaate üleminek parandatud; lisatud hübriid- ja valikutega režiim, privaatne korduvkasutatav tiimilingi vaade ning lukustatud režiimiga vastajalingid. Uued voorud ja ekspordid sisaldavad režiimi ning tiimi/vastaja tunnust. Tuntud sünonüümid aktsepteeritakse, tundmatud vabavastused jäävad ülevaatuseks.

Kohalik versioon: setup:local kasutab sama 2900 pildiga privaatset andmepaketti ja 21 ülesandega vooru nagu pilv, väljastades kohalikud tiimi- ja vastajalingid. Sünteetiline 7-pildiline demo on eraldi setup:demo käsk.
