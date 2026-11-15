// CampusFix seed data and script (task: seed). Behaviour is specified in API.md "Seeding".
// Importing this module never seeds; `node scripts/seed.js` seeds DB_PATH (default location).

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_DB_PATH, ENV } from '../shared/contract.js';
import { openStore } from '../server/store.js';

// Fixed, fictional timestamps so a fresh seed is reproducible: day of November 2026, hh:mm UTC.
const at = (day, hh, mm = 0) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;

// 24 fictional tickets. Titles are unique: seeding is idempotent by title.
// `comments` (optional) are added through the store's public addComment API after the ticket exists.
export const SEED_TICKETS = Object.freeze([
  // ---- network ---------------------------------------------------------------------------
  {
    title: 'Wi-Fi drops in Maple Hall east wing',
    description: 'Residents on floors 2 and 3 lose their Wi-Fi connection every 20 minutes or so and must reconnect manually.',
    category: 'network',
    priority: 'high',
    status: 'open',
    assignedTo: null,
    createdAt: at(12, 8, 15),
    updatedAt: at(12, 8, 15),
  },
  {
    title: 'Library third floor ethernet ports are dead',
    description: 'None of the wall ports in the quiet study area on the third floor deliver a link light or an address.',
    category: 'network',
    priority: 'medium',
    status: 'in_progress',
    assignedTo: 'Avery Chen',
    createdAt: at(9, 10, 30),
    updatedAt: at(11, 14, 5),
    comments: ['Patch panel in the third floor closet is powered but the uplink to the core switch is down.'],
  },
  {
    title: 'Eduroam login loop on student phones',
    description: 'Several students report being asked for their credentials repeatedly on phones after the weekend certificate update.',
    category: 'network',
    priority: 'high',
    status: 'in_progress',
    assignedTo: 'Priya Raman',
    createdAt: at(10, 9, 0),
    updatedAt: at(13, 11, 40),
    comments: [
      'Reproduced on two Android phones; iPhones look unaffected so far.',
      'Radius server certificate chain was missing an intermediate. Fix staged for tonight.',
    ],
  },
  {
    title: 'VPN timeouts from off-campus housing',
    description: 'Staff working from the Riverside apartments get disconnected from the VPN after about five minutes of idle time.',
    category: 'network',
    priority: 'medium',
    status: 'open',
    assignedTo: null,
    createdAt: at(11, 16, 20),
    updatedAt: at(11, 16, 20),
  },
  {
    title: 'Dean office shared printer queue is slow',
    description: 'Print jobs sent to the shared printer in the dean office take several minutes to start.',
    category: 'network',
    priority: 'low',
    status: 'resolved',
    assignedTo: 'Jordan Okafor',
    createdAt: at(3, 13, 10),
    updatedAt: at(5, 9, 45),
  },
  {
    title: 'Guest Wi-Fi captive portal will not load',
    description: 'Visitors at the welcome desk connect to the guest network but the sign-in page never appears.',
    category: 'network',
    priority: 'medium',
    status: 'resolved',
    assignedTo: 'Avery Chen',
    createdAt: at(4, 8, 50),
    updatedAt: at(6, 15, 25),
    comments: ['Portal redirect rule was pointing at a retired hostname. Updated and verified on three devices.'],
  },
  {
    title: 'Cafeteria access point reboots every hour',
    description: 'The access point above the cafeteria serving counter restarts on the hour and drops everyone connected to it.',
    category: 'network',
    priority: 'low',
    status: 'open',
    assignedTo: null,
    createdAt: at(13, 12, 5),
    updatedAt: at(13, 12, 5),
  },
  {
    title: 'DNS lookups fail in the Engineering Annex',
    description: 'Names for internal services fail to resolve from the Annex classrooms while public sites still work.',
    category: 'network',
    priority: 'high',
    status: 'resolved',
    assignedTo: 'Priya Raman',
    createdAt: at(2, 7, 40),
    updatedAt: at(3, 10, 0),
  },
  // ---- equipment -------------------------------------------------------------------------
  {
    title: 'Microscope lamp flickering in Biology 110',
    description: 'Two of the teaching microscopes at the back bench flicker and go dark when the stage is moved.',
    category: 'equipment',
    priority: 'medium',
    status: 'open',
    assignedTo: null,
    createdAt: at(12, 14, 30),
    updatedAt: at(12, 14, 30),
  },
  {
    title: 'Lecture hall 3 microphone has heavy static',
    description: 'The wireless lapel microphone crackles continuously; the handheld one cuts out after a few seconds.',
    category: 'equipment',
    priority: 'high',
    status: 'in_progress',
    assignedTo: 'Mateo Alvarez',
    createdAt: at(11, 9, 15),
    updatedAt: at(13, 8, 30),
  },
  {
    title: 'Markers and erasers missing in Room 12',
    description: 'The whiteboard tray in Room 12 has been empty for a week and instructors are bringing their own supplies.',
    category: 'equipment',
    priority: 'low',
    status: 'resolved',
    assignedTo: 'Sam Whitlock',
    createdAt: at(5, 11, 0),
    updatedAt: at(6, 8, 20),
  },
  {
    title: '3D printer jammed in the Makerspace',
    description: 'Printer number two stopped mid-job with filament stuck in the extruder and will not accept new prints.',
    category: 'equipment',
    priority: 'medium',
    status: 'in_progress',
    assignedTo: 'Jordan Okafor',
    createdAt: at(10, 15, 45),
    updatedAt: at(12, 10, 10),
    comments: ['Extruder disassembled; waiting on a replacement nozzle from the supplier.'],
  },
  {
    title: 'Chemistry fume hood sash is stuck',
    description: 'The sash on fume hood 4 will not lower past halfway, so the hood cannot be used for experiments.',
    category: 'equipment',
    priority: 'high',
    status: 'open',
    assignedTo: null,
    createdAt: at(13, 9, 5),
    updatedAt: at(13, 9, 5),
  },
  {
    title: 'Laptop cart charger is overheating',
    description: 'The charging bay in the loaner laptop cart is too hot to touch after a couple of hours plugged in.',
    category: 'equipment',
    priority: 'high',
    status: 'resolved',
    assignedTo: 'Mateo Alvarez',
    createdAt: at(1, 13, 30),
    updatedAt: at(4, 16, 0),
    comments: ['Replaced the faulty power strip and added a ventilated shelf. Temperature is normal after a full charge cycle.'],
  },
  {
    title: 'Document camera will not power on in Room 305',
    description: 'The document camera on the instructor desk shows no light at all when the power button is pressed.',
    category: 'equipment',
    priority: 'low',
    status: 'open',
    assignedTo: null,
    createdAt: at(8, 10, 0),
    updatedAt: at(8, 10, 0),
  },
  {
    title: 'Gym treadmill belt is slipping',
    description: 'The third treadmill in the fitness centre slips under load and jerks when the speed is raised.',
    category: 'equipment',
    priority: 'medium',
    status: 'open',
    assignedTo: null,
    createdAt: at(11, 18, 10),
    updatedAt: at(11, 18, 10),
  },
  // ---- facilities ------------------------------------------------------------------------
  {
    title: 'Leaking ceiling tile in Science Building lobby',
    description: 'Water drips from a ceiling tile near the front desk whenever it rains and a bucket is collecting it.',
    category: 'facilities',
    priority: 'high',
    status: 'in_progress',
    assignedTo: 'Sam Whitlock',
    createdAt: at(9, 8, 0),
    updatedAt: at(13, 13, 15),
    comments: [
      'Roof drain above the lobby is partly blocked with leaves. Cleaning scheduled for Monday.',
      'Placed a wet-floor sign and moved the bucket away from the walkway.',
    ],
  },
  {
    title: 'Broken door latch on Dorm B laundry room',
    description: 'The laundry room door no longer latches so it swings open and cannot be locked overnight.',
    category: 'facilities',
    priority: 'medium',
    status: 'open',
    assignedTo: null,
    createdAt: at(12, 19, 25),
    updatedAt: at(12, 19, 25),
  },
  {
    title: 'Parking lot C light is out',
    description: 'The lamp post at the north end of lot C has been dark for several evenings.',
    category: 'facilities',
    priority: 'low',
    status: 'resolved',
    assignedTo: 'Sam Whitlock',
    createdAt: at(2, 18, 45),
    updatedAt: at(5, 14, 30),
  },
  {
    title: 'Arts Studio 2 heating is too hot',
    description: 'The radiators in Studio 2 stay on full and the room reaches uncomfortable temperatures during afternoon classes.',
    category: 'facilities',
    priority: 'medium',
    status: 'in_progress',
    assignedTo: 'Mateo Alvarez',
    createdAt: at(10, 12, 30),
    updatedAt: at(12, 9, 50),
  },
  {
    title: 'Level 2 water fountain has no pressure',
    description: 'The drinking fountain by the level 2 stairs only dribbles water and the bottle filler does not work.',
    category: 'facilities',
    priority: 'low',
    status: 'open',
    assignedTo: null,
    createdAt: at(13, 15, 55),
    updatedAt: at(13, 15, 55),
  },
  {
    title: 'Loose stairwell handrail in the Humanities building',
    description: 'The handrail on the east stairwell between floors 1 and 2 moves when held and may pull off the wall.',
    category: 'facilities',
    priority: 'high',
    status: 'open',
    assignedTo: null,
    createdAt: at(14, 7, 45),
    updatedAt: at(14, 7, 45),
  },
  {
    title: 'Graffiti on the bike shelter wall',
    description: 'Paint tags cover the back wall of the bike shelter beside the Student Union.',
    category: 'facilities',
    priority: 'low',
    status: 'resolved',
    assignedTo: 'Jordan Okafor',
    createdAt: at(1, 9, 20),
    updatedAt: at(3, 15, 0),
  },
  {
    title: 'Student Union elevator is out of service',
    description: 'The main elevator displays an out-of-order message and stops between floors, leaving only the stairs for access.',
    category: 'facilities',
    priority: 'high',
    status: 'in_progress',
    assignedTo: 'Avery Chen',
    createdAt: at(13, 7, 30),
    updatedAt: at(14, 9, 0),
  },
]);

// Inserts the seed tickets whose title is not already present; returns { inserted, skipped }.
// Comments are only added to tickets inserted by this call, so repeated runs change nothing.
export function seed(store) {
  const existing = new Set(store.listTickets({}).map((ticket) => ticket.title));
  let inserted = 0;
  let skipped = 0;

  for (const entry of SEED_TICKETS) {
    if (existing.has(entry.title)) {
      skipped += 1;
      continue;
    }
    const ticket = store.createTicket(
      {
        title: entry.title,
        description: entry.description,
        category: entry.category,
        priority: entry.priority,
      },
      {
        status: entry.status,
        assignedTo: entry.assignedTo,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
    );
    for (const body of entry.comments ?? []) store.addComment(ticket.id, { body });
    existing.add(entry.title);
    inserted += 1;
  }

  return { inserted, skipped };
}

function runCli() {
  const dbPath = process.env[ENV.dbPath] ?? DEFAULT_DB_PATH;
  const store = openStore(dbPath);
  try {
    const { inserted, skipped } = seed(store);
    console.log(`Seeded ${dbPath}: inserted ${inserted}, skipped ${skipped}`);
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli();
}
