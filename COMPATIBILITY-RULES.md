# Compatibility Rules — v2 (for builder review)

**Citation shown in the app:** "Compatibility logic: NOAA CAMEO Chemicals reactive groups (via PubChem). Segregation rules: Cornell EHS Laboratory Safety Manual (Appendices K and L), CDC/ATSDR, and OSHA 29 CFR 1910.106 / 1910.253."

## Sources (linked from every rule in the app — see `SOURCES` in `src/rules.js`)

| Source | Used for | Checked |
|---|---|---|
| [Cornell EHS Appendix L: Segregation Scheme](https://ehs.cornell.edu/research-safety/chemical-safety/laboratory-safety-manual/appendix-l-ehs-segregation-scheme) | "Never store together": oxidizers + flammables, acids + bases, acids + cyanides, water-reactives + moisture; organic liquid acids in flammables cabinet at ≥80% (rule 17) | ✅ opened 2026-11-19 |
| [Cornell EHS Appendix K: Incompatible Chemicals](https://ehs.cornell.edu/research-safety/chemical-safety/laboratory-safety-manual/appendix-k-incompatible-chemicals) | Hypochlorites–acids, Ca hypochlorite–ammonia, cyanides/sulfides/azides–acids, nitric–acetic acid | ✅ opened 2026-11-19 |
| [Cornell EHS 7.11 Chemical Segregation](https://ehs.cornell.edu/research-safety/chemical-safety/laboratory-safety-manual/chapter-7-safe-chemical-use/711-chemical) | Oxidizers vs flammables; acids vs bases (same cabinet only with physical separation) | ✅ opened 2026-11-19 |
| [Cornell EHS Appendix J: Peroxide Formers](https://ehs.cornell.edu/research-safety/chemical-safety/laboratory-safety-manual/appendix-j-peroxide-forming-chemicals) | Ether dating note | search summary only |
| [CDC/ATSDR Public Health Statement: Chlorine](https://www.atsdr.cdc.gov/toxprofiles/tp172-c1-b.pdf) | Bleach + acid → chlorine | search summary only |
| [WA State Dept of Health: Bleach Mixing Dangers](https://doh.wa.gov/YouandYourFamily/HealthyHome/Contaminants/BleachMixingDangers) | Bleach + ammonia → chloramines; bleach + acid | search summary only |
| [CDC Fact Sheet: Sodium Azide](https://www.cdc.gov/chemical-emergencies/chemical-fact-sheets/sodium-azide.html) | Azide + acid → hydrazoic acid | search summary only |
| [OSHA 29 CFR 1910.253](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.253) | Oxygen vs fuel-gas cylinders (20 ft / 5 ft barrier, ½-hr rating); no unventilated lockers | search summary only |
| [OSHA 29 CFR 1910.106](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.106) | Flammable liquids storage (rules 16–17): cabinets max 60 gal of Category 1–3, labelled "Flammable - Keep Fire Away" ((d)(3)); **water-reactives not in the same room as flammable liquids ((d)(7)(iv))** | ✅ opened 2026-11-19 |
| [OSHA 29 CFR 1910.1450](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1450) | Designated areas for select carcinogens, reproductive toxins, high acute toxicity ((e)(3)(viii)(A)) | ✅ opened 2026-11-19 |
| [NOAA CAMEO Reactive Groups](https://cameochemicals.noaa.gov/browse/react) | Main classification layer | search summary only |
| [NIH Chemical Segregation Table](https://ors.od.nih.gov/sr/ds/Documents/chemical-segregation-table.pdf) | Rule 11 (inorganic vs non-oxidizing organic acids) | ⚠️ not opened (site unreachable from build machine) |
| [Prudent Practices in the Laboratory (NRC 2011)](https://www.nap.edu/catalog/12654) | Pyrophorics, organic peroxides | catalog only |

**Dropped:** IMDG Code (only secondary summaries found), NFPA 30 (paywalled), NFPA 704 (not a segregation scheme).
**Still to verify by opening:** the NIH table (rule 11 depends on it).

**Rule 19 (builder, 2026-11-20):** hypochlorite + ketones (CAMEO "Ketones", e.g. acetone) or isopropyl alcohol (by name) → 🔴 forms chloroform (haloform reaction). Source: [CDC/ATSDR Toxicological Profile for Chloroform, Ch. 5](https://www.atsdr.cdc.gov/toxprofiles/tp6-c5.pdf) (search summary: bleach + isopropyl alcohol → chloroform). Notes: strictly only *methyl* ketones do this, but CAMEO's "Ketones" group includes all ketones, so a few non-methyl ketones will be flagged too (errs on the safe side). Ethanol also reacts in principle but isn't included until a source names it.

**Rule 18 (builder, 2026-11-19):** water-reactive + flammable or combustible liquid (H224–H227) → 🔴 not in the same room or area; a separate cabinet inside the room doesn't satisfy OSHA 1910.106(d)(7)(iv). Plus a storage note for every water-reactive chemical: dry, isolated, inert gas or mineral oil where required, secondary containment, Class D extinguisher for reactive metals. (The builder also cited IFC Chapter 67; not yet opened, so not linked in the app.)

## How it works

For each chemical, the app gets two things from PubChem (both already in the data we fetch, no new connections):

1. **CAMEO reactive groups**: NOAA's classification, e.g. bleach → "Salts, Basic" + "Oxidizing Agents, Strong". This is the **main layer**. It tells acids from bases and finds cyanides, sulfides and azides.
2. **GHS H-codes**: used for things CAMEO groups don't capture directly (flammability class, gases, water reactivity, storage-only rules).

Then every pair of chemicals is checked against the rules in Part B. All matching rules are reported, worst first.

**Tested 2026-11-19:** all 18 test chemicals have CAMEO groups in PubChem (bleach, HCl, NaOH, HNO₃, H₂SO₄, acetic acid, ammonia, NH₄OH, NaCN, Na₂S, NaN₃, H₂O₂, acetone, toluene, glycine, sodium, ether, KMnO₄).
**Known gap:** PubChem rarely includes EU EUH codes (sodium has H260 but no EUH014), so no rule depends on EUH codes.

## Verdicts

- 🔴 **DO NOT MIX / STORE APART**: dangerous reaction or toxic gas
- 🟡 **SEGREGATE**: separate cabinet or secondary containment
- 🟢 **COMPATIBLE: SAME STORAGE CLASS**: can generally be stored together, always stated with conditions (rule 16)
- ⚪ **NO RULE MATCHED**: the agent must say "no incompatibility found in these rules, check both SDSs", **never "safe"**
- If a chemical has **no CAMEO groups**, the agent says the check is incomplete for it

---

## Part A — Group definitions

| Group | Matched by |
|---|---|
| **Strong acid** | CAMEO "Acids, Strong Oxidizing" or "Acids, Strong Non-oxidizing" |
| **Oxidizing acid** | CAMEO "Acids, Strong Oxidizing", or (H314 **and** H272) |
| **Any acid** | Strong acid, or CAMEO "Acids, Weak", "Acids, Carboxylic", "Salts, Acidic" |
| **Inorganic acid** | CAMEO "Acids, Strong Oxidizing", "Acids, Strong Non-oxidizing" |
| **Organic acid** | CAMEO "Acids, Carboxylic" |
| **Strong base** | CAMEO "Bases, Strong" |
| **Any base** | Strong base, or CAMEO "Bases, Weak", "Salts, Basic" |
| **Oxidizer** | CAMEO "Oxidizing Agents, Strong" / "Acids, Strong Oxidizing", or H270, H271, H272 |
| **Reducing agent** | CAMEO "Reducing Agents, Strong" |
| **Flammable** | H220, H221, H222, H223, H224, H225, H226, H228 |
| **Organic** (fuel for oxidizers) | Flammable, or CAMEO organic families (Hydrocarbons, Ketones, Alcohols, Ethers, Esters, Aldehydes, Amines, Acids Carboxylic…) |
| **Cyanide** | CAMEO "Cyanides, Inorganic" |
| **Sulfide** | CAMEO "Sulfides, Inorganic" |
| **Azide** | CAMEO "Azo, Diazo, Azido, Hydrazine, and Azide Compounds" |
| **Water-reactive** | H260, H261, or CAMEO "Metals, Alkali, Very Active", "Metal Hydrides, Metal Alkyls, Metal Aryls, and Silanes" |
| **Aqueous** | CAMEO "Water and Aqueous Solutions" |
| **Pyrophoric** | H250 |
| **Organic peroxide** | H240, H241, H242, or CAMEO "Peroxides, Organic" |
| **Flammable gas** | H220 or H221 |
| **Oxidizing gas** | H270 |
| **Hypochlorite** ⚠️ name-based | name contains "hypochlorite" (the only name match: narrow and specific) |
| **Ammonia / ammonium** ⚠️ name-based | name contains "ammonia" or "ammonium" |

## Part B — Pair rules

| # | Chemical 1 | Chemical 2 | Verdict | Why (shown to user) | Source |
|---|---|---|---|---|---|
| 1 | Hypochlorite | Any acid | 🔴 | Releases chlorine gas, even with weak acids such as vinegar. | Poison control / CDC |
| 2 | Hypochlorite | Ammonia / ammonium | 🔴 | Produces toxic chloramine gases. | Poison control / CDC |
| 3 | Any acid | Cyanide | 🔴 | Releases hydrogen cyanide gas. | Cornell EHS; NIH |
| 4 | Any acid | Sulfide | 🔴 | Releases hydrogen sulfide gas. | Cornell EHS |
| 5 | Any acid | Azide | 🔴 | Forms hydrazoic acid (toxic, explosive). | EU CLP (EUH032 group) |
| 6 | Any acid | Any base | 🟡 | Store separately. Mixing neutralises them into a salt and water. With concentrated strong acids or bases this releases a lot of heat and can boil and spatter. | Cornell EHS; IMDG SGG1/SGG18; NIH |
| 7 | Alkali / alkaline-earth / active metal (CAMEO "Metals, Alkali, Very Active" or "Metals, Elemental and Powder, Active") | Chlorinated hydrocarbon (CAMEO "Halogenated Organic Compounds" / "Aryl Halides" with "chlor" in the name) | 🔴 | Can react violently, even explosively. Store apart; no water, foam, CO₂ or CCl₄ on metal fires, use Class D or dry sand. | Cornell EHS Appendix K |
| 8 | Oxidizer | Flammable / organic | 🔴 | Oxidizer feeds combustion: fire or explosion. | Cornell EHS; NIH |
| 9 | Oxidizer | Reducing agent | 🔴 | Violent redox reaction. | CAMEO; Prudent Practices |
| 10 | Oxidizing acid | Organic acid / organic | 🔴 | e.g. nitric + acetic acid: violent oxidation. | NIH; Wesleyan EHS |
| 11 | Inorganic acid | Organic acid | 🟡 | Keep inorganic and organic acids in separate cabinets. | NIH chart |
| 12 | Water-reactive | Aqueous or any acid | 🔴 | Reacts violently: flammable or toxic gas and heat. | CAMEO; EUH014 meaning |
| 13 | Pyrophoric | Flammable or oxidizer | 🔴 | Ignites in air; fire spreads to neighbours. | Prudent Practices |
| 14 | Organic peroxide | Oxidizer, reducing agent, strong acid or strong base | 🔴 | Can decompose violently. | Prudent Practices |
| 16 | Flammable liquid (H224/H225/H226) | Flammable liquid | 🟢 | **Only if no rule above fired.** Compatible flammable solvents can generally be stored together, in a fire-rated flammable storage cabinet, away from heat, ignition sources and oxidizers. | OSHA 1910.106; NFPA 30 |
| 17 | Flammable liquid | Flammable organic acid (e.g. glacial acetic acid) | 🟢 | **Only if no rule above fired.** Yes, with strict precautions: the acid is also corrosive, so use secondary containment in a fire-rated flammables cabinet, away from heat, ignition sources, oxidizers, oxidizing acids (nitric) and bases. Some guidelines keep organic acids separate from solvents, so follow the site's storage plan. | OSHA 1910.106; NFPA 30; university EHS guides |
| 15 | Oxidizing gas | Flammable gas | 🔴 | Cylinders at least 20 ft apart or separated by a non-combustible barrier at least 5 ft high. | OSHA 1910.253 |

## Part C — Single-chemical storage notes (shown with any check)

| Trigger | Note |
|---|---|
| H290 | Corrosive to metals: don't store on metal shelving. |
| H280, H281 | Gas cylinder: secure upright, ventilated area, never in closed lockers or cupboards (OSHA). |
| H350, H340, H360 | Carcinogen / mutagen / reproductive toxin: use a designated area under the OSHA Lab Standard (H-codes approximate OSHA's "select carcinogen" lists). |
| CAMEO "Ethers" | May form explosive peroxides: date on receipt and on opening. |
| H314 | Corrosive at the classified concentration (see below). |

## Concentration caveat (agent must say this when relevant)

PubChem's GHS data describes the **pure substance**. Classification changes with concentration (e.g. HCl is Skin Corr. 1B at ≥25% but only Skin Irrit. 2 at 10–25%), and suppliers don't apply H290 consistently. **The CAMEO groups don't depend on concentration**, so the acid/base and gas-release rules still apply to dilute solutions. Always tell the user to check the actual product SDS.

---

## Builder decisions (2026-11-19)

- Acid + base (strong or weak): 🟡 **store separately**, not 🔴: mixing forms a salt (rule 6, merged from old 6 and 7).
- (2026-11-25) Number 7 reused for a new rule: alkali/alkaline-earth metals + chlorinated hydrocarbons → 🔴 (Cornell Appendix K, opened and quoted 2026-11-25: "Alkaline and alkaline earth metals, such as Sodium, Potassium, Cesium, Lithium, Magnesium, Calcium" vs "Carbon tetrachloride and other chlorinated hydrocarbons"). Fills a gap: sodium + chloroform used to give ⚪. Limited to chlorinated (not brominated) solvents, as the source says. Rules now run 1–19 with no gaps.
- Name-based matches for hypochlorite and ammonia/ammonium kept (no objection).
- Toluene + acetone: compatible flammable solvents → new 🟢 verdict (rule 16), always with the storage conditions. Ranked below ⚪ for the overall verdict, so one unknown pair keeps the overall answer cautious.
- Acetone + glacial acetic acid: yes, with strict precautions (both flammable; acid also corrosive; guidelines differ) → rule 17 🟢 with secondary-containment conditions.
