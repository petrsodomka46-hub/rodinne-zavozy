# Rodinné závozy – návod

**Adresa aplikace: <https://petrsodomka46-hub.github.io/rodinne-zavozy/>**
(kód: <https://github.com/petrsodomka46-hub/rodinne-zavozy>, data: Supabase projekt `dnmwhftbdudyfslahpwd`)

Webová aplikace (PWA) pro plánování závozů dětí do školy a na kroužky.
Děti zadávají, kdy a kam potřebují, rodiče potvrzují, kdo je poveze.
Na iPhonu se přidá na plochu a chová se jako normální aplikace.

## Jak aplikace funguje

| Kdo | Co dělá |
|---|---|
| **Tomáš, Elen** | Přidávají jízdy (do školy, ze školy, na kroužek, z kroužku a **ostatní** – cokoli navíc, kam/odkud napíšou sami) s časem a způsobem: *potřebuji odvoz / pěšky / na kole / na skútru / autobus / s jiným rodičem*. Mohou zadat i cestu zpět a opakování každý týden. Banner je upozorní, když nemají naplánováno aspoň 14 dní dopředu. |
| **Petr, Miluška** | V záložce **K vyřízení** jedním klepnutím přiřadí řidiče (Táta / Máma) Potvrzuje se jen *potřebuji odvoz*; pěšky, na kole, na skútru, autobusem i s jiným rodičem platí hned, jak to dítě zadá. U opakované jízdy lze přiřadit celou řadu najednou. Záložka **Řídím** ukazuje, koho a kdy vezou. |

Pravidla hlídá přímo databáze:
- Dítě může měnit jen své jízdy a nemůže si samo přiřadit rodiče.
- Když dítě změní datum, čas, místo nebo způsob, potvrzení se zruší a rodiče jízdu znovu uvidí v *K vyřízení*. Změna poznámky potvrzení nezruší.
- Když dítě zruší už potvrzenou jízdu, rodiče ji uvidí jako *Zrušeno*.

## Vyzkoušení na počítači (demo)

```
npx http-server -p 5173 -c-1
```

Otevřít <http://localhost:5173>. Bez vyplněné konfigurace běží **DEMO režim** s ukázkovými daty uloženými jen v prohlížeči.

## Zprovoznění (jednou, ~15 minut)

### 1. Supabase projekt
1. <https://supabase.com/dashboard> → **New project** (region *Central EU (Frankfurt)*, heslo databáze si uložte).
2. **SQL Editor → New query** → vložit obsah `supabase/01_schema.sql` → **Run**.

### 2. Účty pro rodinu
1. **Authentication → Users → Add user → Create new user**, 4×, vždy zaškrtnout **Auto Confirm User**:
   - e-maily stejné jako v `js/config.js` (výchozí `petr@zavozy.example`, `miluska@…`, `tomas@…`, `elen@…`).
     Pokud Supabase výchozí adresy odmítne, použijte skutečné nebo třeba `petrsodomka46+tomas@gmail.com`
     a změňte je v `js/config.js` **i** v `supabase/02_clenove.sql`.
   - heslo aspoň 6 znaků (dětem něco, co si zapamatují).
2. **SQL Editor** → spustit `supabase/02_clenove.sql`. Musí vypsat 4 řádky.
3. **Authentication → Sign In / Providers → Email** → vypnout **Allow new users to sign up**
   (nikdo cizí si pak nezaloží účet).

### 3. Propojení aplikace
**Project Settings → API**: zkopírovat **Project URL** a **anon public** klíč do `js/config.js`
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Anon klíč smí být veřejný – data chrání pravidla v databázi.

### 4. Zveřejnění (hosting zdarma)
Aplikace je jen sada statických souborů. Možnosti:
- **GitHub Pages** – repozitář → Settings → Pages → *Deploy from branch* `main`, složka `/`.
  Repozitář musí být veřejný (na bezplatném účtu). Kód neobsahuje nic tajného, jen jména a přihlašovací e-maily.
- **Netlify Drop** – <https://app.netlify.com/drop>, přetáhnout celou složku. Zdarma, repozitář netřeba.

**Nasazení úprav** (aplikace běží na GitHub Pages z větve `main`): zvyšte číslo `CACHE` v `sw.js`
(`zavozy-v3`, …), pak `git commit` a `git push`. Za 1–2 minuty si telefony při dalším otevření stáhnou novou verzi.

### 5. Instalace na iPhone
Safari → otevřít adresu aplikace → **Sdílet** (čtvereček se šipkou) → **Přidat na plochu** → otevřít ikonou → přihlásit se.
Přihlášení zůstane uložené.

## Struktura

```
index.html, manifest.webmanifest, sw.js   – PWA (instalace, offline start)
css/app.css                               – vzhled (světlý i tmavý režim)
js/config.js                              – nastavení: Supabase, členové rodiny
js/app.js                                 – obrazovky a ovládání
js/api.js                                 – data: Supabase nebo DEMO
js/util.js                                – práce s datem
supabase/01_schema.sql                    – tabulky, pravidla, oprávnění
supabase/02_clenove.sql                   – propojení účtů s rodinou
tools/make_icons.py                       – generátor ikon
```

## Možná rozšíření
- Push notifikace (nový požadavek → rodiče, potvrzení → dítě) – iOS 16.4+ u aplikace na ploše.
- Export do kalendáře iPhonu.
