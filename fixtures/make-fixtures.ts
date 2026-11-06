import fs from 'node:fs';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname);

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escapeCell = (cell: string | number) => {
    const s = String(cell ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ].join('\n') + '\n';
}

export function generateClean25(): string {
  const headers = ['Name', 'Email', 'Event', 'Award', 'Date'];
  const awards = [
    '1st Prize', '2nd Prize', '3rd Prize', 'Best UI',
    'Best Pitch', 'Honourable Mention', 'Participation', 'Special Mention',
  ];
  const participants: [string, string][] = [
    ['Aarav Sharma', 'aarav.sharma@example.edu'],
    ['Diya Patel', 'diya.patel@example.edu'],
    ['Rohan Mehta', 'rohan.mehta@example.edu'],
    ['Ananya Iyer', 'ananya.iyer@example.edu'],
    ['Kabir Singh', 'kabir.singh@example.edu'],
    ['Meera Nair', 'meera.nair@example.edu'],
    ['Vihaan Gupta', 'vihaan.gupta@example.edu'],
    ['Ishita Reddy', 'ishita.reddy@example.edu'],
    ['Arjun Krishnan', 'arjun.krishnan@example.edu'],
    ['Saanvi Joshi', 'saanvi.joshi@example.edu'],
    ['Aditya Verma', 'aditya.verma@example.edu'],
    ['Nisha Bansal', 'nisha.bansal@example.edu'],
    ['Rahul Desai', 'rahul.desai@example.edu'],
    ['Priya Menon', 'priya.menon@example.edu'],
    ['Siddharth Rao', 'siddharth.rao@example.edu'],
    ['Tanvi Kulkarni', 'tanvi.kulkarni@example.edu'],
    ['Yash Agarwal', 'yash.agarwal@example.edu'],
    ['Kavya Pillai', 'kavya.pillai@example.edu'],
    ['Harsh Vardhan Chauhan', 'harsh.chauhan@example.edu'],
    ['Zoya Khan', 'zoya.khan@example.edu'],
    ['Dev Malhotra', 'dev.malhotra@example.edu'],
    ['Riya Fernandes', 'riya.fernandes@example.edu'],
    ['Aryan Bhatt', 'aryan.bhatt@example.edu'],
    ['Lakshmi Narayanan Venkataraghavan', 'lakshmi.n@example.edu'],
    ['Elena Petrova', 'elena.petrova@example.edu'],
  ];

  const rows = participants.map(([name, email], idx) => [
    name,
    email,
    'HackFest 2026',
    awards[idx % awards.length],
    '2026-03-14',
  ]);

  return toCsv(headers, rows);
}

export function generateDirty(): string {
  const headers = ['Name', 'Email', 'Event', 'Award', 'Date'];
  const rows: (string | number)[][] = [
    ['Alice Johnson', 'alice.johnson@example.com', 'HackFest 2026', '1st Prize', '2026-03-14'],
    ['Bob Smith', 'bob.smith@example.com', 'HackFest 2026', '2nd Prize', '2026-03-14'],

    ['', 'missing.name1@example.com', 'HackFest 2026', 'Participation', '2026-03-14'],
    ['   ', 'missing.name2@example.com', 'HackFest 2026', 'Participation', '2026-03-14'],

    ['Charlie Brown', 'invalid-email-no-at', 'HackFest 2026', '3rd Prize', '2026-03-14'],
    ['Diana Prince', 'diana@', 'HackFest 2026', 'Honourable Mention', '2026-03-14'],
    ['Evan Wright', '@example.com', 'HackFest 2026', 'Participation', '2026-03-14'],
    ['Fiona Gallagher', 'fiona with spaces@domain.com', 'HackFest 2026', 'Best UI', '2026-03-14'],
    ['George Costanza', '', 'HackFest 2026', 'Participation', '2026-03-14'],
    ['Hannah Abbott', 'hannah@@doubleat.com', 'HackFest 2026', 'Participation', '2026-03-14'],

    ['Ian Malcolm', 'ian.malcolm@example.com', 'HackFest 2026', 'Best Pitch', '2026-03-14'],
    ['Ian Malcolm', 'ian.malcolm@example.com', 'HackFest 2026', 'Best Pitch', '2026-03-14'],

    ['Julia Roberts', 'julia.roberts@example.com', 'HackFest 2026', 'Special Mention', '2026-03-14'],
    ['Julia Roberts', 'julia.roberts@example.com', 'HackFest 2026', 'Special Mention', '2026-03-14'],

    ['Kevin Bacon', 'kevin.bacon@example.com', 'HackFest 2026', 'Participation', '2026-03-14'],
    ['Laura Croft', 'laura.croft@example.com', 'HackFest 2026', 'Participation', '2026-03-14'],
  ];

  return toCsv(headers, rows);
}

export function generateShuffledColumns(): string {
  const headers = ['Prize / Category', 'Date of Issue', 'E-Mail Address', 'Full Name', 'Event Title'];
  const rows = [
    ['1st Prize', '2026-03-14', 'alexandra.d@college.edu', 'Alexandra Danvers', 'Tech Innovate 2026'],
    ['2nd Prize', '2026-03-14', 'bruce.wayne@college.edu', 'Bruce Wayne', 'Tech Innovate 2026'],
    ['3rd Prize', '2026-03-14', 'clark.kent@college.edu', 'Clark Kent', 'Tech Innovate 2026'],
    ['Best UI', '2026-03-14', 'diana.prince@college.edu', 'Diana Prince', 'Tech Innovate 2026'],
    ['Best Pitch', '2026-03-14', 'barry.allen@college.edu', 'Barry Allen', 'Tech Innovate 2026'],
    ['Honourable Mention', '2026-03-14', 'hal.jordan@college.edu', 'Hal Jordan', 'Tech Innovate 2026'],
    ['Special Mention', '2026-03-14', 'arthur.curry@college.edu', 'Arthur Curry', 'Tech Innovate 2026'],
    ['Participation', '2026-03-14', 'victor.stone@college.edu', 'Victor Stone', 'Tech Innovate 2026'],
  ];

  return toCsv(headers, rows);
}

export function generateAwards(): string {
  const headers = ['Name', 'Email', 'Event', 'Award', 'Achievement', 'Date'];
  const rows = [
    ['Aarav Sharma', 'aarav.sharma@example.edu', 'HackFest 2026', '1st Prize', 'Grand Champion of HackFest 2026', '2026-03-14'],
    ['Aarav Sharma', 'aarav.sharma@example.edu', 'HackFest 2026', 'Best UI', 'Outstanding Interface Design', '2026-03-14'],
    ['Aarav Sharma', 'aarav.sharma@example.edu', 'HackFest 2026', 'Best Pitch', 'Most Compelling Demo & Pitch', '2026-03-14'],

    ['Diya Patel', 'diya.patel@example.edu', 'HackFest 2026', '2nd Prize', 'First Runner-Up', '2026-03-14'],
    ['Diya Patel', 'diya.patel@example.edu', 'HackFest 2026', 'Special Mention', 'Jury Recognition for Social Impact', '2026-03-14'],

    ['Rohan Mehta', 'rohan.mehta@example.edu', 'HackFest 2026', '3rd Prize', 'Second Runner-Up', '2026-03-14'],
    ['Rohan Mehta', 'rohan.mehta@example.edu', 'HackFest 2026', 'Honourable Mention', 'Excellence in Technical Architecture', '2026-03-14'],

    ['Ananya Iyer', 'ananya.iyer@example.edu', 'HackFest 2026', 'Best UI', 'Best Accessibility & Responsive Design', '2026-03-14'],
    ['Ananya Iyer', 'ananya.iyer@example.edu', 'HackFest 2026', 'Participation', 'Active Contributor & Participant', '2026-03-14'],

    ['Kabir Singh', 'kabir.singh@example.edu', 'HackFest 2026', '1st Prize', 'Overall Winner', '2026-03-14'],
    ['Meera Nair', 'meera.nair@example.edu', 'HackFest 2026', '2nd Prize', 'Runner Up', '2026-03-14'],
    ['Vihaan Gupta', 'vihaan.gupta@example.edu', 'HackFest 2026', '3rd Prize', 'Third Place', '2026-03-14'],
    ['Ishita Reddy', 'ishita.reddy@example.edu', 'HackFest 2026', 'Best Pitch', 'Clear and engaging presentation', '2026-03-14'],
    ['Arjun Krishnan', 'arjun.krishnan@example.edu', 'HackFest 2026', 'Honourable Mention', 'Notable implementation', '2026-03-14'],
    ['Saanvi Joshi', 'saanvi.joshi@example.edu', 'HackFest 2026', 'Participation', 'Completed 36-hour hackathon', '2026-03-14'],
    ['Elena Petrova', 'elena.petrova@example.edu', 'HackFest 2026', 'Special Mention', 'Creative AI Agent Integration', '2026-03-14'],
  ];

  return toCsv(headers, rows);
}

export function generateLongNames(): string {
  const headers = ['Name', 'Email', 'Event', 'Award', 'Date'];
  const rows = [
    ['Hubert Blaine Wolfeschlegelsteinhausenbergerdorff Senior', 'hubert@example.edu', 'International Symposium on Computing 2026', 'Distinguished Lifetime Achievement', '2026-03-14'],
    ['Venkata Satya Sai Krishna Prasad Subrahmanyam', 'v.subrahmanyam@example.edu', 'National Engineering Olympiad 2026', '1st Prize', '2026-03-14'],
    ['Alexander Montgomery Cornwallis-Fitzwilliam III', 'alexander.cf@example.edu', 'Grand Collegiate Hackathon 2026', 'Best Architecture', '2026-03-14'],
    ['María del Rosario Cayetana Paloma Alfonsa Victoria Eugenia Fernanda Teresa Francisca de Paula Lourdes Antonia Josefa Fausta Rita Castor Dorotea Santa Esperanza Fitz-James Stuart y de Silva Falcó y Gurtubay', 'maria.fitzjames@example.edu', 'Ibero-American Innovation Summit 2026', 'Grand Laureate', '2026-03-14'],
    ['Lakshmi Narayanan Venkataraghavan Ramachandran', 'lakshmi.vr@example.edu', 'International Code Challenge 2026', 'Gold Medal', '2026-03-14'],

    ['José Ignacio García-Fernández', 'jose.garcia@example.edu', 'Conferencia de Innovación Tecnológica 2026', 'Primer Premio', '2026-03-14'],
    ['Éléonore François-Benoît de Châteaubriant', 'eleonore.chateaubriant@example.edu', 'Concours Francophone de Robotique 2026', 'Prix d\'Excellence', '2026-03-14'],
    ['Inès Maïwenn Zoé Müller-Gauthier', 'ines.muller@example.edu', 'European Design & Code Expo 2026', 'Best Visual Identity', '2026-03-14'],
    ['Ángel Nuñez Valdés', 'angel.nunez@example.edu', 'Certamen Científico 2026', 'Mención de Honor', '2026-03-14'],
    ['François René de Chateaubriand', 'francois.rene@example.edu', 'Grand Prix Littéraire et Technique 2026', 'Lauréat', '2026-03-14'],

    ['अनन्या शर्मा', 'ananya.sharma@example.edu', 'अखिल भारतीय तकनीकी सम्मेलन 2026', 'प्रथम पुरस्कार', '2026-03-14'],
    ['विहान कृष्णमूर्ति', 'vihaan.k@example.edu', 'डिजिटल नवाचार प्रतियोगिता 2026', 'सर्वश्रेष्ठ परियोजना', '2026-03-14'],
    ['ऋषिराज चक्रवर्ती', 'rishiraj.c@example.edu', 'राष्ट्रीय प्रौद्योगिकी महोत्सव 2026', 'विशिष्ट उपलब्धि', '2026-03-14'],
    ['प्रियांशु सिंह बघेल', 'priyanshu.singh@example.edu', 'युवा वैज्ञानिक पुरस्कार 2026', 'प्रशंसा पत्र', '2026-03-14'],
    ['डॉ. सर्वपल्ली राधाकृष्णन मेमोरियल अवार्ड', 'radhakrishnan.memorial@example.edu', 'शैक्षणिक उत्कृष्टता सम्मान 2026', 'सर्वोच्च सम्मान', '2026-03-14'],
  ];

  return toCsv(headers, rows);
}

export function writeAllFixtures(targetDir = FIXTURES_DIR) {
  fs.mkdirSync(targetDir, { recursive: true });

  const files: Record<string, string> = {
    'clean25.csv': generateClean25(),
    'dirty.csv': generateDirty(),
    'shuffled-columns.csv': generateShuffledColumns(),
    'awards.csv': generateAwards(),
    'long-names.csv': generateLongNames(),
  };

  for (const [filename, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, filename);
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Wrote fixture: ${fullPath} (${content.trim().split('\n').length - 1} rows)`);
  }
}

if (require.main === module || process.argv[1]?.includes('make-fixtures')) {
  writeAllFixtures();
  console.log('All fixtures generated successfully.');
}
