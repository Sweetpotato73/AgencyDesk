/**
 * End-to-end API test. Requires the server running (npm run dev) with Postgres + storage up.
 *   npm run test:e2e            (defaults to http://localhost:4000)
 *   API_URL=https://... npm run test:e2e
 */
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.API_URL ?? 'http://localhost:4000';
const run = Date.now().toString(36);
let passed = 0;
let failed = 0;

function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m`, extra ?? '');
  }
}

class Agent {
  cookie = '';
  constructor(public label: string) {}
  async req<T = any>(method: string, path: string, body?: unknown, opts: { csrf?: boolean } = {}): Promise<{ status: number; data: T }> {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.csrf === false ? {} : { 'X-Requested-With': 'XMLHttpRequest' }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }
  get = <T = any>(p: string) => this.req<T>('GET', p);
  post = <T = any>(p: string, b: unknown = {}) => this.req<T>('POST', p, b);
  patch = <T = any>(p: string, b: unknown) => this.req<T>('PATCH', p, b);
  del = <T = any>(p: string) => this.req<T>('DELETE', p);

  socket(): Promise<Socket & { events: { event: string; payload: any }[] }> {
    return new Promise((resolve, reject) => {
      const s = io(BASE, { path: '/socket.io', transports: ['websocket'], extraHeaders: { Cookie: this.cookie }, forceNew: true }) as Socket & {
        events: { event: string; payload: any }[];
      };
      s.events = [];
      s.onAny((event, payload) => s.events.push({ event, payload }));
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(s: { events: { event: string; payload: any }[] }, pred: (e: { event: string; payload: any }) => boolean, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (s.events.some(pred)) return true;
    await sleep(50);
  }
  return false;
}
const join = (s: Socket, projectId: string) => new Promise<{ ok: boolean }>((r) => s.emit('project:join', projectId, r));

async function main() {
  console.log(`\nE2E against ${BASE}\n`);
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check('health endpoint', health.ok, health);

  // ── Auth & tenancy ──
  console.log('\nAuth & tenancy');
  const owner = new Agent('owner');
  const reg = await owner.post('/auth/register', { agencyName: `E2E Agency ${run}`, name: 'Owner One', email: `owner-${run}@e2e.test`, password: 'password123' });
  check('register agency', reg.status === 201 && reg.data.user.role === 'OWNER', reg.data);
  check('session cookie set', owner.cookie.startsWith('portal_session='));
  const dup = await new Agent('x').post('/auth/register', { agencyName: 'X', name: 'X', email: `owner-${run}@e2e.test`, password: 'password123' });
  check('duplicate email rejected (409)', dup.status === 409);
  const badLogin = await new Agent('x').post('/auth/login', { email: `owner-${run}@e2e.test`, password: 'wrong-password' });
  check('wrong password rejected (401)', badLogin.status === 401);
  const shortPw = await new Agent('x').post('/auth/register', { agencyName: 'X', name: 'X', email: `x-${run}@e2e.test`, password: 'short' });
  check('weak password rejected with field error', shortPw.status === 400 && shortPw.data.details?.password, shortPw.data);
  const csrf = await owner.req('POST', '/clients', { name: 'nope' }, { csrf: false });
  check('CSRF header required on mutations (403)', csrf.status === 403);
  const anon = await new Agent('anon').get('/projects');
  check('unauthenticated request rejected (401)', anon.status === 401);
  const publicBrand = await new Agent('anon').get(`/public/orgs/${reg.data.org.slug}`);
  check('public branding endpoint', publicBrand.status === 200 && publicBrand.data.name === `E2E Agency ${run}`);

  const branding = await owner.patch('/org', { brandColor: '#10b981', currency: 'EUR' });
  check('update branding', branding.status === 200 && branding.data.brandColor === '#10b981' && branding.data.currency === 'eur');
  const badColor = await owner.patch('/org', { brandColor: 'red' });
  check('invalid brand color rejected', badColor.status === 400);

  // ── Clients & invites ──
  console.log('\nClients & invites');
  const clientRes = await owner.post('/clients', { name: 'Acme E2E', email: 'billing@acme-e2e.test' });
  check('create client', clientRes.status === 201);
  const clientId = clientRes.data.id;

  const inv = await owner.post('/org/invites', { email: `client-${run}@e2e.test`, role: 'CLIENT', clientId });
  check('create client invite (link returned)', inv.status === 201 && inv.data.inviteUrl.includes('/invite/'));
  const token = inv.data.inviteUrl.split('/invite/')[1];
  const invInfo = await new Agent('anon').get(`/auth/invite/${token}`);
  check('invite lookup shows client + branding', invInfo.data.clientName === 'Acme E2E' && invInfo.data.org.brandColor === '#10b981');
  const client = new Agent('client');
  const acc = await client.post('/auth/accept-invite', { token, name: 'Client Person', password: 'password123' });
  check('accept invite as client', acc.status === 201 && acc.data.user.role === 'CLIENT' && acc.data.client.id === clientId, acc.data);
  const reuse = await new Agent('x').post('/auth/accept-invite', { token, name: 'Again', password: 'password123' });
  check('invite cannot be reused', reuse.status === 404);

  const mInv = await owner.post('/org/invites', { email: `member-${run}@e2e.test`, role: 'MEMBER' });
  const member = new Agent('member');
  const mAcc = await member.post('/auth/accept-invite', { token: mInv.data.inviteUrl.split('/invite/')[1], name: 'Member Mo', password: 'password123' });
  check('accept invite as team member', mAcc.status === 201 && mAcc.data.user.role === 'MEMBER');
  const memberInvitesAdmin = await member.post('/org/invites', { email: `x-${run}@e2e.test`, role: 'ADMIN' });
  check('member cannot invite admins (403)', memberInvitesAdmin.status === 403);
  const clientSeesClients = await client.get('/clients');
  check('client cannot list agency clients (403)', clientSeesClients.status === 403);

  // Another agency for isolation checks
  const other = new Agent('other');
  await other.post('/auth/register', { agencyName: `Other ${run}`, name: 'Other', email: `other-${run}@e2e.test`, password: 'password123' });

  // ── Projects ──
  console.log('\nProjects');
  const proj = await owner.post('/projects', { name: 'Brand Refresh', clientId, description: 'E2E project', dueDate: '2030-01-31' });
  check('create project', proj.status === 201);
  const projectId = proj.data.id;
  const clientList = await client.get('/projects');
  check('client sees their project', clientList.data.some((p: any) => p.id === projectId));
  const otherGet = await other.get(`/projects/${projectId}`);
  check('other agency cannot access project (404)', otherGet.status === 404);
  const clientEdit = await client.patch(`/projects/${projectId}`, { name: 'hacked' });
  check('client cannot edit project (403)', clientEdit.status === 403);

  // Second client of same agency must not see it
  const c2 = await owner.post('/clients', { name: 'Other Client' });
  const inv2 = await owner.post('/org/invites', { email: `client2-${run}@e2e.test`, role: 'CLIENT', clientId: c2.data.id });
  const client2 = new Agent('client2');
  await client2.post('/auth/accept-invite', { token: inv2.data.inviteUrl.split('/invite/')[1], name: 'Client Two', password: 'password123' });
  const c2get = await client2.get(`/projects/${projectId}`);
  check("another client of the same agency can't see the project", c2get.status === 404);

  // ── Realtime ──
  console.log('\nRealtime (WebSockets)');
  const sOwner = await owner.socket();
  const sClient = await client.socket();
  const sOther = await other.socket();
  check('owner joins project room', (await join(sOwner, projectId)).ok);
  check('client joins project room', (await join(sClient, projectId)).ok);
  check('other agency is refused the room', !(await join(sOther, projectId)).ok);
  const badSocket = await new Agent('anon').socket().then(() => 'connected', (e) => e.message);
  check('socket without session refused', badSocket === 'unauthorized', badSocket);

  // ── Milestones ──
  console.log('\nMilestones & approvals');
  const ms = await owner.post(`/projects/${projectId}/milestones`, { title: 'Logo concepts', dueDate: '2030-01-10' });
  check('create milestone', ms.status === 201);
  const msId = ms.data.id;
  check('client socket got milestone:changed', await waitFor(sClient, (e) => e.event === 'milestone:changed' && e.payload.milestoneId === msId));
  const earlyApprove = await client.post(`/milestones/${msId}/approve`);
  check('cannot approve before submission (400)', earlyApprove.status === 400);
  const submit = await member.post(`/milestones/${msId}/submit`, { note: 'Please review the three concepts' });
  check('member submits milestone for approval', submit.status === 200 && submit.data.status === 'AWAITING_APPROVAL');
  check('client got approval notification in realtime', await waitFor(sClient, (e) => e.event === 'notification' && e.payload.type === 'milestone.submitted'));
  const memberApprove = await member.post(`/milestones/${msId}/approve`);
  check('non-admin staff cannot approve on behalf of client (403)', memberApprove.status === 403);
  const noNote = await client.post(`/milestones/${msId}/request-changes`, { note: '  ' });
  check('request changes requires a note (400)', noNote.status === 400);
  const changes = await client.post(`/milestones/${msId}/request-changes`, { note: 'Make the logo bigger' });
  check('client requests changes', changes.data.status === 'CHANGES_REQUESTED' && changes.data.decisionNote === 'Make the logo bigger');
  check('owner notified of change request', await waitFor(sOwner, (e) => e.event === 'notification' && e.payload.type === 'milestone.changes_requested'));
  await owner.post(`/milestones/${msId}/submit`);
  const approve = await client.post(`/milestones/${msId}/approve`, { note: 'Perfect!' });
  check('client approves milestone', approve.data.status === 'APPROVED' && approve.data.decidedById === acc.data.user.id);
  const ms2 = await owner.post(`/projects/${projectId}/milestones`, { title: 'Second' });
  await owner.post(`/milestones/${ms2.data.id}/move`, { direction: 'up' });
  const pAfterMove = await owner.get(`/projects/${projectId}`);
  check('reorder milestones', pAfterMove.data.milestones[0].id === ms2.data.id);

  // ── Tasks ──
  console.log('\nTasks & privacy');
  const t1 = await owner.post(`/projects/${projectId}/tasks`, { title: 'Send brand assets', milestoneId: msId, assigneeId: mAcc.data.user.id });
  check('create task with assignee', t1.status === 201 && t1.data.assignee.id === mAcc.data.user.id);
  const memberSock = await member.socket();
  check('member realtime connection', memberSock.connected);
  sClient.events.length = 0;
  const internal = await owner.post(`/projects/${projectId}/tasks`, { title: 'Internal: budget', clientVisible: false });
  await sleep(400);
  check('internal task event NOT sent to client socket', !sClient.events.some((e) => e.event === 'task:changed' && e.payload.taskId === internal.data.id));
  const clientTasks = await client.get(`/projects/${projectId}/tasks`);
  check('client task list hides internal tasks', clientTasks.data.length === 1 && clientTasks.data[0].id === t1.data.id);
  const clientInternal = await client.get(`/tasks/${internal.data.id}`);
  check('client cannot open internal task (404)', clientInternal.status === 404);
  const badAssignee = await owner.post(`/projects/${projectId}/tasks`, { title: 'x', assigneeId: acc.data.user.id });
  check('cannot assign tasks to client users (400)', badAssignee.status === 400);
  const moved = await member.patch(`/tasks/${t1.data.id}`, { status: 'IN_REVIEW' });
  check('move task across board', moved.data.status === 'IN_REVIEW');
  const clientMove = await client.patch(`/tasks/${t1.data.id}`, { status: 'DONE' });
  check('client cannot change tasks (403)', clientMove.status === 403);

  // ── Comments ──
  console.log('\nMessaging');
  sOwner.events.length = 0;
  const c1 = await client.post(`/projects/${projectId}/comments`, { body: 'Here are our assets', taskId: t1.data.id });
  check('client comments on task', c1.status === 201);
  check('owner receives comment:new instantly', await waitFor(sOwner, (e) => e.event === 'comment:new' && e.payload.id === c1.data.id));
  check('owner receives comment notification', await waitFor(sOwner, (e) => e.event === 'notification' && e.payload.type === 'comment.new'));
  const cInt = await client.post(`/projects/${projectId}/comments`, { body: 'sneaky', taskId: internal.data.id });
  check('client cannot comment on internal task (404)', cInt.status === 404);
  sClient.events.length = 0;
  const staffNote = await owner.post(`/projects/${projectId}/comments`, { body: 'internal note', taskId: internal.data.id });
  await sleep(400);
  check('internal comment NOT pushed to client', staffNote.status === 201 && !sClient.events.some((e) => e.event === 'comment:new'));
  const general = await owner.post(`/projects/${projectId}/comments`, { body: 'Welcome aboard!' });
  check('project-level discussion message', general.status === 201 && general.data.taskId === null);
  const thread = await client.get(`/projects/${projectId}/comments`);
  check('client reads discussion thread', thread.data.comments.some((c: any) => c.id === general.data.id));
  const editOther = await client.patch(`/comments/${general.data.id}`, { body: 'edited by client' });
  check("client can't edit others' messages (403)", editOther.status === 403);
  const edit = await client.patch(`/comments/${c1.data.id}`, { body: 'Here are our assets (v2)' });
  check('edit own message', edit.status === 200 && edit.data.editedAt);
  sClient.emit('typing', { projectId, taskId: null });
  check('typing indicator relayed to others', await waitFor(sOwner, (e) => e.event === 'typing' && e.payload.user.name === 'Client Person'));

  // ── Files ──
  console.log('\nFile sharing (presigned upload to storage)');
  const content = `hello from e2e ${run} ` + 'x'.repeat(5000);
  const reg1 = await client.post(`/projects/${projectId}/files`, { name: 'brief.txt', size: content.length, mimeType: 'text/plain', taskId: t1.data.id });
  check('register upload → presigned URL', reg1.status === 201 && reg1.data.upload.url);
  const uploadUrl = reg1.data.upload.url.startsWith('/') ? `${BASE}${reg1.data.upload.url}` : reg1.data.upload.url;
  const put = await fetch(uploadUrl, { method: 'PUT', headers: reg1.data.upload.headers, body: content });
  check('PUT bytes directly to storage', put.ok, put.status + ' ' + (await put.text()).slice(0, 300));
  sOwner.events.length = 0;
  const done = await client.post(`/files/${reg1.data.fileId}/complete`);
  check('complete upload (verified in storage)', done.status === 200 && done.data.size === content.length, done.data);
  check('owner gets file:changed in realtime', await waitFor(sOwner, (e) => e.event === 'file:changed'));
  const list = await owner.get(`/projects/${projectId}/files`);
  check('file listed with task context', list.data.length === 1 && list.data[0].task?.id === t1.data.id);
  const link = await owner.get(`/files/${reg1.data.fileId}/url`);
  const dlUrl = link.data.url.startsWith('/') ? `${BASE}${link.data.url}` : link.data.url;
  const dl = await fetch(dlUrl);
  const dlText = await dl.text();
  check('download via signed URL returns same bytes', dl.ok && dlText === content, dl.status);
  check('download is served as attachment', (dl.headers.get('content-disposition') ?? '').startsWith('attachment'));
  const ghost = await owner.post(`/projects/${projectId}/files`, { name: 'ghost.bin', size: 10 });
  const ghostDone = await owner.post(`/files/${ghost.data.fileId}/complete`);
  check('completing a never-uploaded file fails (400)', ghostDone.status === 400);
  const tooBig = await owner.post(`/projects/${projectId}/files`, { name: 'huge.bin', size: 50 * 1024 ** 3 });
  check('oversized upload rejected up front (400)', tooBig.status === 400);
  const otherFile = await other.get(`/files/${reg1.data.fileId}/url`);
  check('other agency cannot get download link (404)', otherFile.status === 404);
  const ownerFile = await owner.post(`/projects/${projectId}/files`, { name: 'owner.txt', size: 3, mimeType: 'text/plain' });
  const ownerUrl = ownerFile.data.upload.url.startsWith('/') ? `${BASE}${ownerFile.data.upload.url}` : ownerFile.data.upload.url;
  await fetch(ownerUrl, { method: 'PUT', headers: ownerFile.data.upload.headers, body: 'abc' });
  await owner.post(`/files/${ownerFile.data.fileId}/complete`);
  const clientDelOwner = await client.del(`/files/${ownerFile.data.fileId}`);
  check("client can't delete agency's files (403)", clientDelOwner.status === 403);
  const intFile = await owner.post(`/projects/${projectId}/files`, { name: 'internal.txt', size: 3, taskId: internal.data.id });
  const intUrl = intFile.data.upload.url.startsWith('/') ? `${BASE}${intFile.data.upload.url}` : intFile.data.upload.url;
  await fetch(intUrl, { method: 'PUT', headers: intFile.data.upload.headers, body: 'abc' });
  await owner.post(`/files/${intFile.data.fileId}/complete`);
  const clientFiles = await client.get(`/projects/${projectId}/files`);
  check('client file list hides internal-task files', !clientFiles.data.some((f: any) => f.id === intFile.data.fileId) && clientFiles.data.length === 2);

  // ── Invoices ──
  console.log('\nInvoices & payments');
  const invc = await owner.post('/invoices', {
    clientId,
    projectId,
    dueDate: '2030-02-01',
    items: [
      { description: 'Logo design', quantity: 1, unitAmount: 150000 },
      { description: 'Revisions', quantity: 3, unitAmount: 10000 },
    ],
  });
  check('create draft invoice with computed total', invc.status === 201 && invc.data.total === 180000 && invc.data.currency === 'eur', invc.data);
  check('invoice numbered sequentially', invc.data.number === 'INV-0001');
  const draftAsClient = await client.get(`/invoices/${invc.data.id}`);
  check('client cannot see drafts (404)', draftAsClient.status === 404);
  const editDraft = await owner.patch(`/invoices/${invc.data.id}`, { items: [{ description: 'Logo design', quantity: 2, unitAmount: 100000 }] });
  check('edit draft line items', editDraft.data.total === 200000);
  sClient.events.length = 0;
  const sent = await owner.post(`/invoices/${invc.data.id}/send`);
  check('send invoice', sent.data.status === 'OPEN' && sent.data.issuedAt);
  check('client notified of new invoice in realtime', await waitFor(sClient, (e) => e.event === 'notification' && e.payload.type === 'invoice.sent'));
  const lockItems = await owner.patch(`/invoices/${invc.data.id}`, { items: [{ description: 'x', quantity: 1, unitAmount: 1 }] });
  check('line items locked after sending (400)', lockItems.status === 400);
  const clientInv = await client.get('/invoices');
  check('client sees open invoice', clientInv.data.some((i: any) => i.id === invc.data.id));
  const client2Inv = await client2.get(`/invoices/${invc.data.id}`);
  check("other client can't see the invoice (404)", client2Inv.status === 404);
  const checkout = await client.post(`/invoices/${invc.data.id}/checkout`);
  if (health.stripe) {
    check('Stripe checkout session created', checkout.status === 200 && String(checkout.data.url).startsWith('https://checkout.stripe.com'), checkout.data);
  } else {
    check('checkout reports Stripe not configured (503)', checkout.status === 503);
  }
  const clientMark = await client.post(`/invoices/${invc.data.id}/mark-paid`);
  check('client cannot mark invoice paid (403)', clientMark.status === 403);
  const paid = await owner.post(`/invoices/${invc.data.id}/mark-paid`);
  check('admin records manual payment', paid.data.status === 'PAID' && paid.data.paidAt);
  check('client gets invoice:changed + paid notification', await waitFor(sClient, (e) => e.event === 'invoice:changed') && (await waitFor(sClient, (e) => e.event === 'notification' && e.payload.type === 'invoice.paid')));
  const voidPaid = await owner.post(`/invoices/${invc.data.id}/void`);
  check('paid invoice cannot be voided (400)', voidPaid.status === 400);
  const webhook = await fetch(`${BASE}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 'bogus' }, body: '{}' });
  check('webhook rejects unsigned/unconfigured requests', webhook.status === 400 || webhook.status === 503);

  // ── Dashboard & notifications ──
  console.log('\nDashboard & notifications');
  const dash = await owner.get('/dashboard');
  check('owner dashboard', dash.status === 200 && dash.data.projects.active === 1 && dash.data.paidThisMonth.eur === 200000, dash.data.paidThisMonth);
  const cdash = await client.get('/dashboard');
  check('client dashboard', cdash.status === 200 && cdash.data.clientCount === undefined);
  const notifs = await client.get('/notifications');
  check('client has unread notifications', notifs.data.unread > 0);
  await client.post('/notifications/read');
  check('mark all notifications read', (await client.get('/notifications')).data.unread === 0);
  const activity = await client.get(`/projects/${projectId}/activity`);
  check('activity feed excludes internal items', activity.data.length > 0 && !activity.data.some((a: any) => a.summary.includes('Internal')));

  // ── Access removal & cleanup ──
  console.log('\nAccess removal & cleanup');
  const rm = await owner.del(`/org/members/${acc.data.user.id}`);
  check('remove client user', rm.status === 200);
  const afterRm = await client.get('/projects');
  check('removed user is signed out immediately (401)', afterRm.status === 401);
  const commentsKept = await owner.get(`/projects/${projectId}/comments?taskId=${t1.data.id}`);
  check("removed user's messages are preserved", commentsKept.data.comments.length === 1);
  const delProj = await owner.del(`/projects/${projectId}`);
  check('delete project', delProj.status === 200);
  const gone = await fetch(dlUrl);
  check('project files purged from storage', gone.status === 404 || gone.status === 403, gone.status);

  for (const s of [sOwner, sClient, sOther, memberSock]) s.disconnect();
  console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} passed, ${failed} failed\x1b[0m\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
