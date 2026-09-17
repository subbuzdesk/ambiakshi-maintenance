# Operational Rules & Behavioral Guidelines

## 1. Autonomous Execution Policy ("Human-on-the-Loop")
- **Work Autonomously**: Execute engineering workflows end-to-end (implementing code, verifying builds, running tests, fixing errors) without prompting the user for minor incremental confirmations.
- **Only Ask When Stuck**: Escalate to the user only when blocked, encountering missing external credentials, or facing irrecoverable errors that require human intervention.
- **Verification First**: Always run automated tests and build checks (`npm run build`) to ensure changes are clean before reporting back.

## 2. Ecosystem Asset Alignment
- **`cortexcatalystweb`**: Refers to the repository and static site generator (Astro SSG) project for CortexCatalyst (not assumed external third-party domain).
- **Ambiakshi Ecosystem Core**:
  - `ambiakshi-home` (`https://ambiakshi.com`)
  - `ambiakshi-tools` (`https://www.ambiakshi.tools`)
  - `ambiakshi-mobile` (`https://mobile.ambiakshi.com`)
  - `ambiakshi-slm` (`https://slm.ambiakshi.com`)
  - `promptcraft-mobile`, `digitle-game`, `vectoshift` (Mobile Games Suite)
  - `radhamahalingam360` (`https://radhamahalingam360.com`)
  - `rkaits` (`https://rkaits.com`)
  - `ambiakshi-coach` (Ambiakshi Ledger Career OS)
  - `cortexcatalystweb` (CortexCatalyst Web Platform)
- **Supabase Databases**:
  - Tools DB: `aglvpztrnfaaxtjdajoh`
  - Home/SLM DB: `issffykfczwktwxitxxy`
