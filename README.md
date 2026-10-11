# Harharetki

**Navigaattori, joka eksyttää sinut tarkoituksella.**

🔗 **Kokeile heti selaimessa: https://loytoretki-beta.vercel.app**

🧭 **Valmis esimerkkiretki yhdellä klikkauksella:** [Rautatientori → Kaivopuisto, historiaretki](https://loytoretki-beta.vercel.app/?a=60.17070,24.94310&an=Rautatientori&b=60.15760,24.95670&bn=Kaivopuisto&tyyli=historic&taso=3)

Softamestari 2026 -esikarsinnan työ (Junnusarja), teemana *Löytöretki*.

---

## Idea

Tavallinen navigaattori optimoi aikaa. Harharetki optimoi **löytöjä**.

Valitse lähtöpiste ja määränpää, sitten retken tyyli:

- **Maisema**: puistojen, rantojen ja puiden kautta. Reitti painottaa vihreitä alueita ja vesistöjen läheisyyttä ja välttää isoja katuja.
- **Historia**: kulkee muistomerkkien, monumenttien ja vanhojen rakennusten kautta, joiden tarinan harva tuntee.
- **Yllätys**: vie harvinaisten kohteiden luo. Ne voivat olla patsaita, siirtolohkareita, observatorioita tai suihkulähteitä, joiden ohi olet kävellyt sata kertaa huomaamatta.

Lisäksi valitset **harhailun määrän** asteikolla 1–5 (pienestä mutkasta kunnon seikkailuun). Ja on tietysti **11** niille, jotka haluavat eksyä kunnolla.

Harharetki näyttää:

- seikkailureitin, joka kulkee jokaisen pysähdyspaikan kautta
- tylsän suorimman reitin katkoviivana vertailun vuoksi
- pysähdysten tarinat (Wikipediasta, jos kohteella on artikkeli)
- sen, kuinka paljon pitempi retki on kuin suorin reitti

**Historiaretkellä:** zoomaa karttaa lähemmäs, niin reitin varren yli 80 vuotta vanhat rakennukset alkavat hehkua ja niiden rakennusvuodet tulevat näkyviin.

Aloitusnäytöllä valitaan, kuljetaanko **kävellen vai autolla**. Automatkat reititetään autoille, ja pysähdykset voivat olla kauempana tiestä. Lisäksi valitaan **kaksi tapaa kokeilla**:

- **Live-testi**: kävele itse puhelimen kanssa. GPS seuraa sijaintiasi kuin navigaattori, näyttää matkan seuraavalle pysähdykselle, ja kun saavut perille, puhelin värähtää ja pysähdyksen tarina aukeaa.
- **Demotila**: pieni tutkimusmatkailija kävelee reitin puolestasi kartalla ja pysähtyy jokaisella löydöllä.

Lisäksi:

- **Jaa retki**: jokainen retki on linkki (lähtö, määränpää, tyyli, taso ja kulkutapa osoitteessa), joten sen voi lähettää kaverille tai avata myöhemmin uudelleen.

Sama arkinen matka muuttuu pieneksi löytöretkeksi.

## Käynnistys

Vaatii Node.js 20.9+ (testattu Node 26:lla).

```bash
npm install
npm run dev
```

Avaa http://localhost:3000. (pnpm toimii myös: `pnpm install && pnpm dev`.)

Ensimmäinen `npm run dev` kopioi MapLibren worker-tiedoston `public/`-kansioon automaattisesti.

Tuotantoversio: `npm run build && npm start`.

Sovellus toimii kokonaan selaimessa. Omaa palvelinta, tietokantaa tai taustajärjestelmää ei ole, eikä API-avaimia tarvita.

### Testaus kehitystilassa

- **Nopea testipolku:** valitse aloitusnäytöltä *Kävellen* ja *Demotila* → napauta kartalta kaksi pistettä Helsingin keskustasta → *Historia*, taso 3 → *Kävele reitti*.
- **Valmis esimerkkiretki:** http://localhost:3000/?a=60.17070,24.94310&an=Rautatientori&b=60.15760,24.95670&bn=Kaivopuisto&tyyli=historic&taso=3
- **Puhelimella samassa Wi-Fi-verkossa:** käynnistä `npm run dev -- -H 0.0.0.0` ja avaa puhelimella `http://<koneen IP-osoite>:3000`. Kehityspalvelin sallii koneen omat verkko-osoitteet automaattisesti.
- **Live-testi (GPS) puhelimella vaatii HTTPS-yhteyden.** Selaimet eivät anna sijaintia http-osoitteelle, joten lähiverkon `http://<IP>:3000`-osoitteessa GPS ei toimi lainkaan (sovellus kertoo tästä ja ohjaa Demotilaan). Kokeile Live-testiä puhelimella julkaistulla sivulla **https://loytoretki-beta.vercel.app**, tai käytä https-tunnelia. Tietokoneella `http://localhost:3000` toimii, koska localhost lasketaan suojatuksi.
- **Data:** Helsingin keskustan reitit lasketaan mukana tulevasta aineistosta, joten ne eivät riipu ruuhkaisista Overpass-palvelimista. Muualla sovellus käyttää OpenStreetMapin, Valhallan ja Wikipedian julkisia rajapintoja, joten testikoneella pitää olla verkkoyhteys (myös karttatiilet ladataan verkosta).

## Miten se toimii

1. **Kartta**: [MapLibre GL](https://maplibre.org/) piirtää OpenStreetMapin vektoritiilet ([OpenFreeMap](https://openfreemap.org/)). Positron-tyyli on värjätty Itämeren sävyihin, ja paikannimet näytetään suomeksi aina kun mahdollista.
2. **Data**: selain hakee [Overpass API](https://overpass-api.de/):sta OpenStreetMapin kävelyverkon (kadut, polut, portaat, läpikulut), puistot, vesistöt ja kiinnostavat kohteet. Helsingin keskustan aineisto on mukana valmiiksi (`public/data/helsinki.json`), joten keskustan retket toimivat heti, vaikka Overpass olisi ruuhkainen. Overpass-kyselyt lähetetään rinnakkain usealle peilipalvelimelle, ja nopein vastaus voittaa.
3. **Reititys**:
   - **Lyhyet matkat** (ja koko Helsingin keskusta) lasketaan omalla reititysmoottorilla selaimessa (`src/lib/routing/`). Se rakentaa OSM-datasta painotetun graafin ja laskee reitit A*-/Dijkstra-algoritmilla. Jokaisella retkityylillä on oma hintafunktio. Esimerkiksi maisemareitillä puiston sisällä kulkeva metri on "halvempi" kuin pääkadun varrella kulkeva.
   - **Pidemmät matkat** reititetään OpenStreetMap-pohjaisella [Valhalla](https://valhalla.github.io/valhalla/)-reitityspalvelulla ([FOSSGIS](https://valhalla1.openstreetmap.de/)). Pysähdyspaikat haetaan Overpassista suorimman reitin ympäriltä. Matkan pituutta ei ole rajoitettu.
   - **Pysähdykset** valitaan lähtö- ja määränpään väliseltä alueelta tyylin, harvinaisuuden, kiinnostavuuden ja sijainnin perusteella. Harhailun määrä säätää pysähdysten määrää ja sitä, kuinka paljon reitti saa venyä. Reitti kulkee jokaisen pysähdyksen kautta, ja samaa tietä takaisin kulkemista vältetään.
   - **Historialliset rakennukset**: reitin varrelta haetaan OSM-rakennukset, joilla on rakennusvuosi (`start_date`) tai historia-/suojelumerkintä (`historic`, `heritage`).
4. **Paikkahaku**: [Photon](https://photon.komoot.io/) (OSM-pohjainen geokoodaus).
5. **Tarinat ja kuvat**: jos OSM-kohteeseen on liitetty Wikipedia-artikkeli, kohteen kuvaus ja kuva haetaan Wikipedian rajapinnasta (suomenkielinen artikkeli ensin, jos sellainen on). Helsingin ulkopuolella pysähdyspaikkoja haetaan myös [Wikipedian GeoSearch](https://www.mediawiki.org/wiki/API:Geosearch)-rajapinnasta paikallisella kielellä ja englanniksi. Sieltä tulevat tunnetut nähtävyydet kuvineen kaikkialla maailmassa. Suosio arvioidaan artikkelin kieliversioiden määrästä. Jos kuvaa ei muuten löydy, se haetaan Wikimedia Commonsista kohteen läheltä.

## Rakenne

```
src/
  app/                 Next.js-sivu, layout ja globaalit tyylit
  components/flow/     Käyttöliittymän kulku (lähtö → tyyli → retki)
  components/map/      Kartta, reittiviivat, merkit ja kävelijäanimaatio
  components/planner/  Paikkahakukenttä
  lib/osm/             Overpass-kysely, datan lataus, geokoodaus
  lib/routing/         Kävelygraafi, POI-luokittelu, reititys ja retkien suunnittelu
  lib/map/             Karttatyyli ja karttageometria
public/data/
  helsinki.json        Helsingin keskustan OSM-aineisto (kävelyverkko, puistot, vesistöt, kohteet)
  buildings.json       Helsingin keskustan rakennukset, joilla on rakennusvuosi tai suojelumerkintä
  places.json          Kevyt nimihakemisto välittömään paikkahakuun
scripts/
  fetch-demo.mjs       Lataa Helsingin keskustan OSM-aineiston uudelleen
  fetch-names.mjs      Hakee hakemistoon aukiot, kaupunginosat, asemat ja kahvilat
  build-places.mjs     Rakentaa nimihakemiston (public/data/places.json)
  fetch-buildings.mjs  Lataa rakennusvuosiaineiston uudelleen
  make-zip.sh          Pakkaa projektin palautusta varten
```

## Tekniikat

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 ja MapLibre GL 6. Saavutettavuus on toteutettu Vercelin Web Interface Guidelines -ohjeiden mukaan: koko kulku toimii näppäimistöllä, fokus näkyy, `prefers-reduced-motion` on huomioitu, ja ruudunlukija saa ilmoitukset `aria-live`-alueen kautta.

## Lähteet ja lisenssit

- Karttadata © [OpenStreetMapin tekijät](https://www.openstreetmap.org/copyright), ODbL
- Vektoritiilet: [OpenFreeMap](https://openfreemap.org/), [OpenMapTiles](https://openmaptiles.org/)
- Kohteiden kuvaukset ja kuvat: [Wikipedia](https://fi.wikipedia.org/), [Wikidata](https://www.wikidata.org/) ja [Wikimedia Commons](https://commons.wikimedia.org/), CC BY-SA / CC0
- Reititys: [Valhalla / FOSSGIS](https://valhalla1.openstreetmap.de/), OpenStreetMap-data
- Paikkahaku: [Photon](https://photon.komoot.io/) ja [Nominatim](https://nominatim.openstreetmap.org/)

Koodi on kilpailun sääntöjen mukaisesti vapaasti käytettävissä (public domain).

---

## In English

**Harharetki** ("the wandering trip") is navigation that gets you lost on purpose. Pick a start and a destination, then choose a *scenic*, *historic* or *surprise* adventure. A custom routing engine runs entirely in the browser on OpenStreetMap data (Overpass API, with central Helsinki bundled for instant demos). It finds a walking route through hand-picked stops and shows how little longer it is than the boring fastest route.

Pick a *wander level* from 1 to 5, or 11 if you really want to get lost, and travel on foot or by car. Short trips use the in-browser engine. Long trips use Valhalla (OSM routing) plus an Overpass corridor search, so there is no distance limit. Historic buildings along the route glow as you zoom in, labelled with their construction years.

Run it with `pnpm install && pnpm dev` (or `npm install && npm run dev`), then open http://localhost:3000. Live version: https://loytoretki-beta.vercel.app
