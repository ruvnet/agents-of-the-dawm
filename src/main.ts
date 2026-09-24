// Coordinator-owned bootstrap. Replaced during integration (C1).
import { loadSector01 } from './contracts/fixtures';

const manifest = loadSector01();
const root = document.getElementById('ui-root');
if (root) root.textContent = `Floodline: manifest ${manifest.id} loaded (integration pending)`;
