export type HelpKey =
  | 'upload' | 'fix' | 'columns' | 'awards' | 'design' | 'email' | 'preview' | 'send'
  | 'dashboard' | 'tickets' | 'settings' | 'googleSignIn' | 'gmailLimit' | 'smtp' | 'drive' | 'linkedin' | 'reportProblem';

export interface HelpEntry { title: string; body: string; tips?: string[] }

export const WIZARD_STEP_KEYS = ['upload', 'columns', 'fix', 'awards', 'design', 'email', 'preview', 'send'] as const satisfies readonly HelpKey[];

export const ALL_HELP_KEYS: readonly HelpKey[] = [
  ...WIZARD_STEP_KEYS,
  'dashboard', 'tickets', 'settings', 'googleSignIn', 'gmailLimit', 'smtp', 'drive', 'linkedin', 'reportProblem',
];

export const HELP: Record<HelpKey, HelpEntry> = {
  upload: {
    title: 'Step 1: Upload your student list',
    body: 'Choose the Excel or CSV file that has one row per student. It needs at least a name column and an email column. You do not have to rearrange anything: columns can be in any order, and title rows above the headings are fine.',
    tips: [
      'Excel (.xlsx, .xls) and CSV files both work.',
      'No file yet? Press "Download sample sheet" to see what a good one looks like, or try it right away.',
      'If someone won the 1st Prize and also took part, give them one row for each award.',
    ],
  },
  fix: {
    title: 'Step 3: Fix any problems',
    body: 'Facilify checks every row before it makes anything. Rows with a missing name, a missing or invalid email, or the same person listed twice for the same award are shown in a table. Type the correction right in the table and press Save corrections. Fixed rows join the rest automatically.',
    tips: [
      'A red row will not get a certificate until it is fixed or left out.',
      'A yellow row will still be processed, but check it. For example, the backup email was used because the main one was empty.',
      'Your original file is never changed. Corrections are saved as a copy.',
      'A repeated row can simply be left out with the "Leave this row out" button.',
    ],
  },
  columns: {
    title: 'Step 2: Match your columns',
    body: 'Tell Facilify which column holds the name, the event, the award, the date and so on. It guesses by reading your headings, so most of the time you only need to glance and press Next. If you used your own heading, type it in the box and Facilify will find it, even with small spelling slips.',
    tips: [
      'Pick which column holds the email address to use. You can also choose a backup email column that is used when the first one is empty.',
      'If two columns look equally good, Facilify asks you instead of guessing.',
      'Your choices can be saved as a profile and reused for the next event.',
    ],
  },
  awards: {
    title: 'Step 4: Prizes and award types',
    body: 'Facilify lists every different award it found in your sheet (for example 1st Prize, Best UI, Participation) and how many students have each. Choose a certificate design for each one. Similar spellings such as "1st", "First Prize" and "Winner" are grouped for you and you can split or merge them.',
    tips: [
      'Different awards can use different designs, email wording, Drive folders and LinkedIn titles.',
      'Anything without a design is flagged before you send, so nobody is missed.',
      'For special cases, such as "Score at least 90", use an advanced rule.',
      'A person with two awards can get one email with both certificates, or two separate emails.',
    ],
  },
  design: {
    title: 'Step 5: Design the certificate',
    body: 'Pick a ready-made design, or upload your own PDF, PNG or JPG. Facilify places the text on top and never changes your artwork. Drag the name, event and award boxes where you want them, then choose the font, size, colour and alignment. Long names shrink or wrap by themselves so they always fit.',
    tips: [
      'Type text like "Awarded to {{NAME}} for {{ACHIEVEMENT}}". The parts in double braces are filled in for each student.',
      'Use the eyedropper to copy an exact colour from your design.',
      'Search the font box to try any Google font. The preview uses the exact same font as the final PDF.',
    ],
  },
  email: {
    title: 'Step 6: Write the email',
    body: 'Write the message every student receives. {{NAME}}, {{EVENT}} and the other fields are replaced with each student\'s own details. Every email carries that student\'s certificate, an "Add to LinkedIn" button, a "Share a post" button and a "Report a problem" button automatically.',
    tips: [
      'Keep it short and friendly. The default text works well.',
      'You can give each award its own wording.',
      'The subject line can use fields too, for example "Your certificate for {{EVENT}}".',
    ],
  },
  preview: {
    title: 'Step 7: Check before you send',
    body: 'See exactly what students will get: a sample certificate and email for each award type. Names that had to be shrunk, wrapped or shortened are listed so you can double-check them. Nothing is sent yet.',
    tips: [
      'Flip through a few different students, especially ones with long names.',
      'Spotted a problem? Go back to the design step. Your work is kept.',
    ],
  },
  send: {
    title: 'Step 8: Send',
    body: 'First send a test email to yourself and check it. Then press Send. You will see a summary such as "Send 248 emails from you@gmail.com?" before anything goes out. Facilify makes each certificate, saves it, and emails it to the right student, one by one. If one email fails, the rest carry on.',
    tips: [
      'The "Test outbox" sender never emails anyone. It saves each email as a file so you can practise safely.',
      'You can close the page while a batch runs. Come back to the dashboard to watch progress.',
      'A student who already received the same award is skipped so nobody gets two copies by accident.',
    ],
  },
  dashboard: {
    title: 'Dashboard',
    body: 'Every batch you have run is here with live counts: Pending, Generated, Sending, Sent and Failed. Open a batch to see each student, retry the ones that failed, download the report as a spreadsheet, or resend one certificate on purpose.',
    tips: [
      'Failed emails usually have a plain-language reason, such as a mistyped address.',
      '"Retry failed" only tries the failed ones again. It never sends to people who already got theirs.',
      'Download the report to share exact results with your team.',
    ],
  },
  tickets: {
    title: 'Correction tickets',
    body: 'When a student presses "Report a problem" in their email, a ticket appears here with their certificate and their row of data side by side. Fix the value in one click and press "Reissue". Facilify remakes the certificate, replaces the Drive copy and emails the corrected version. The student is told when it is done.',
    tips: [
      'A badge on the menu shows how many tickets are open.',
      'Students do not need an account. Their link is private to their own certificate.',
      'If the report is not right, reject it with a short note and the student is told why.',
    ],
  },
  settings: {
    title: 'Settings',
    body: 'Set your organisation name once, and choose how emails are sent and where certificates are saved. The Test outbox and a folder on your computer work out of the box. Connect Google or an email server when you are ready to send for real.',
    tips: [
      'Your organisation name appears on certificates, emails and LinkedIn entries.',
      'Passwords and Google connections are stored encrypted and never shown again.',
      'Switch back to Test outbox any time to practise.',
    ],
  },
  googleSignIn: {
    title: 'Sign in with Google',
    body: 'One click connects your Google account. Facilify asks for three things only: who you are, permission to send email as you, and permission to save files into a Drive folder it creates itself. It cannot read your inbox or open your other files.',
    tips: [
      'Emails are sent from your own Gmail address, so replies come back to you.',
      'You can disconnect at any time from your Google account security page.',
      'Only email addresses on the organizer list can sign in.',
      'During testing Google may show "This app isn\'t verified". Choose Advanced, then Continue. This is normal for apps in testing.',
    ],
  },
  gmailLimit: {
    title: 'Gmail daily sending limit',
    body: 'Google limits how many emails an account can send per day: about 500 for a free Gmail account and about 2,000 for Google Workspace (a college or company account). Facilify counts every email and stops before the limit, so nothing bounces. Whatever is left waits, and you press Continue the next day.',
    tips: [
      'Sending to more than about 500 students? Use a Workspace account or a college email server (SMTP).',
      'Split a big list across two days if you need to.',
      'The Test outbox has no limit at all.',
    ],
  },
  smtp: {
    title: 'Send with an email server (SMTP)',
    body: 'If you would rather not connect Google, you can use any email provider that gives you SMTP details: a server name, a port, a username and a password. Gmail (with an App Password), Outlook, your college mail server, Amazon SES and Brevo all work. Press "Send a test" in Settings to check it.',
    tips: [
      'Port 587 with "STARTTLS" is the most common. Port 465 uses "TLS".',
      'Gmail needs an App Password, not your normal password. Create one in your Google account under Security.',
      'Ask your IT team for the details if you use a college server.',
    ],
  },
  drive: {
    title: 'Saving certificates to Google Drive',
    body: 'Every certificate is also saved in your Google Drive, tidily sorted by event and award, for example Facilify / CodeSprint 2026 / 1st Prize. A _reports folder holds the status spreadsheet. If you retry, files are never duplicated. Without Google, certificates are saved in a folder on your computer instead.',
    tips: [
      'Facilify can only see files it created itself.',
      'You can change the folder layout in Settings.',
      'Share the event folder with your faculty advisor so they can see everything.',
    ],
  },
  linkedin: {
    title: 'LinkedIn buttons',
    body: 'Each email has an "Add to LinkedIn profile" button. It opens LinkedIn with the certificate name, your organisation, the date and a verification link already filled in. The student can edit anything before saving. A second button, "Share a post", shares the certificate\'s verification page.',
    tips: [
      'Set your organisation name once in Settings. Adding your LinkedIn company ID (optional) links the entry to your page.',
      'You can turn the LinkedIn buttons off in Settings.',
    ],
  },
  reportProblem: {
    title: 'Report a problem (for students)',
    body: 'If your name, event, award or date is wrong on your certificate, press "Report a problem" at the bottom of the email. Say what is wrong and what it should be. The organizers get your report and send you a corrected certificate.',
    tips: [
      'No account or password is needed.',
      'One open report per certificate is enough.',
    ],
  },
};

export const SAMPLE_SHEET_CSV = `Student Name,Student ID,Student Email,Personal Email,Event,Certificate Type,Achievement,Date
Aarav Sharma,CS2101,aarav.sharma@college.edu,aarav.s@gmail.com,CodeSprint 2026,1st Prize,Winner of the 24-hour CodeSprint hackathon,2026-03-14
Diya Patel,CS2114,diya.patel@college.edu,diya.patel@gmail.com,CodeSprint 2026,2nd Prize,Runner-up in the CodeSprint hackathon,2026-03-14
Rohan Mehta,EC2087,rohan.mehta@college.edu,,CodeSprint 2026,3rd Prize,Third place in the CodeSprint hackathon,2026-03-14
Ananya Iyer,IT2203,ananya.iyer@college.edu,ananya.iyer@outlook.com,CodeSprint 2026,Honourable Mention,Honourable mention for innovation,2026-03-14
Kabir Singh,CS2119,kabir.singh@college.edu,,CodeSprint 2026,Best UI,Best user interface design,2026-03-14
Meera Nair,CS2132,meera.nair@college.edu,meera.nair@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Vihaan Gupta,ME2056,vihaan.gupta@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Ishita Reddy,IT2218,ishita.reddy@college.edu,ishita.r@yahoo.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Arjun Krishnan,CS2145,arjun.krishnan@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Saanvi Joshi,EC2091,saanvi.joshi@college.edu,saanvi.joshi@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Aditya Verma,CS2150,aditya.verma@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Nisha Bansal,IT2231,nisha.bansal@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Rahul Desai,ME2071,rahul.desai@college.edu,rahul.desai@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Priya Menon,CS2166,priya.menon@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Siddharth Rao,EC2102,siddharth.rao@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Tanvi Kulkarni,IT2244,tanvi.kulkarni@college.edu,tanvi.k@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Yash Agarwal,CS2171,yash.agarwal@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Kavya Pillai,CS2183,kavya.pillai@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Harsh Vardhan Chauhan,ME2088,harsh.chauhan@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Zoya Khan,IT2257,zoya.khan@college.edu,zoya.khan@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Dev Malhotra,EC2115,dev.malhotra@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Riya Fernandes,CS2194,riya.fernandes@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Aryan Bhatt,CS2201,aryan.bhatt@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Lakshmi Narayanan Venkataraghavan,EC2123,lakshmi.n@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Kabir Singh,CS2119,kabir.singh@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
`;

export const DIRTY_SAMPLE_CSV = `Student Name,Student ID,Student Email,Personal Email,Event,Certificate Type,Achievement,Date
Aarav Sharma,CS2101,aarav.sharma@college.edu,aarav.s@gmail.com,CodeSprint 2026,1st Prize,Winner of the 24-hour CodeSprint hackathon,2026-03-14
Diya Patel,CS2114,diya.patel@college.edu,diya.patel@gmail.com,CodeSprint 2026,2nd Prize,Runner-up in the CodeSprint hackathon,2026-03-14
,EC2087,rohan.mehta@college.edu,,CodeSprint 2026,3rd Prize,Third place in the CodeSprint hackathon,2026-03-14
Ananya Iyer,IT2203,ananya.iyer@college.edu,ananya.iyer@outlook.com,CodeSprint 2026,Honourable Mention,Honourable mention for innovation,2026-03-14
Kabir Singh,CS2119,kabir.singh@college,,CodeSprint 2026,Best UI,Best user interface design,2026-03-14
Meera Nair,CS2132,meera.nair@college.edu,meera.nair@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Vihaan Gupta,ME2056,,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Ishita Reddy,IT2218,ishita.reddy@college.edu,ishita.r@yahoo.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Arjun Krishnan,CS2145,arjun.krishnan@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Saanvi Joshi,EC2091,saanvi.joshi@college.edu,saanvi.joshi@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Saanvi Joshi,EC2091,saanvi.joshi@college.edu,saanvi.joshi@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Nisha Bansal,IT2231,nisha.bansal@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Rahul Desai,ME2071,rahul.desai@college.edu,rahul.desai@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Priya Menon,CS2166,priya.menon@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Siddharth Rao,EC2102,siddharth.rao@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Tanvi Kulkarni,IT2244,tanvi.kulkarni@college.edu,tanvi.k@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Yash Agarwal,CS2171,yash.agarwal@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Kavya Pillai,CS2183,kavya.pillai@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Harsh Vardhan Chauhan,ME2088,harsh.chauhan@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Zoya Khan,IT2257,zoya.khan@college.edu,zoya.khan@gmail.com,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Dev Malhotra,EC2115,dev.malhotra@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Riya Fernandes,CS2194,riya.fernandes@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Aryan Bhatt,CS2201,aryan.bhatt@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Lakshmi Narayanan Venkataraghavan,EC2123,lakshmi.n@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
Kabir Singh,CS2119,kabir.singh@college.edu,,CodeSprint 2026,Participation,Participated in CodeSprint 2026,2026-03-14
`;
