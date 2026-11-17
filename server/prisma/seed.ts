/**
 * Demo data. Run with `npm run db:seed` (wipes the demo workspace first, leaves others untouched).
 *
 *   Agency owner:  owner@demo.test   / password123
 *   Team member:   sam@demo.test     / password123
 *   Client user:   client@acme.test  / password123
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const day = (n: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

async function main() {
  const existing = await prisma.organization.findUnique({ where: { slug: 'northwind-studio' } });
  if (existing) await prisma.organization.delete({ where: { id: existing.id } });
  await prisma.user.deleteMany({ where: { email: { in: ['owner@demo.test', 'sam@demo.test', 'client@acme.test', 'maria@globex.test'] } } });

  const passwordHash = await bcrypt.hash('password123', 12);
  const org = await prisma.organization.create({
    data: { name: 'Northwind Studio', slug: 'northwind-studio', brandColor: '#4f46e5', invoiceCounter: 2 },
  });
  const owner = await prisma.user.create({
    data: { email: 'owner@demo.test', name: 'Olivia Reed', role: 'OWNER', orgId: org.id, passwordHash },
  });
  const sam = await prisma.user.create({
    data: { email: 'sam@demo.test', name: 'Sam Patel', role: 'MEMBER', orgId: org.id, passwordHash },
  });

  const acme = await prisma.client.create({
    data: { orgId: org.id, name: 'Acme Corp', email: 'billing@acme.test', phone: '+1 555 0100' },
  });
  const globex = await prisma.client.create({ data: { orgId: org.id, name: 'Globex Inc', email: 'ap@globex.test' } });

  const clientUser = await prisma.user.create({
    data: { email: 'client@acme.test', name: 'Chris Morgan', role: 'CLIENT', orgId: org.id, clientId: acme.id, passwordHash },
  });
  await prisma.user.create({
    data: { email: 'maria@globex.test', name: 'Maria Lopez', role: 'CLIENT', orgId: org.id, clientId: globex.id, passwordHash },
  });

  // ── Acme website redesign ──
  const web = await prisma.project.create({
    data: {
      orgId: org.id,
      clientId: acme.id,
      name: 'Website Redesign',
      description: 'Full redesign of acme.com: new brand system, marketing pages and a headless CMS.',
      dueDate: day(45),
    },
  });
  const [discovery, design, build] = await Promise.all([
    prisma.milestone.create({
      data: {
        projectId: web.id,
        title: 'Discovery & sitemap',
        description: 'Stakeholder interviews, analytics review and the final sitemap.',
        status: 'APPROVED',
        position: 0,
        dueDate: day(-10),
        submittedAt: day(-12),
        decidedAt: day(-11),
        decidedById: clientUser.id,
        decisionNote: 'Looks great, approved!',
      },
    }),
    prisma.milestone.create({
      data: {
        projectId: web.id,
        title: 'Homepage design',
        description: 'High-fidelity desktop + mobile designs for the homepage.',
        status: 'AWAITING_APPROVAL',
        position: 1,
        dueDate: day(3),
        submittedAt: day(-1),
      },
    }),
    prisma.milestone.create({
      data: { projectId: web.id, title: 'Development & launch', status: 'PENDING', position: 2, dueDate: day(40) },
    }),
  ]);
  void build;

  const tasks = [
    { title: 'Run stakeholder interviews', status: 'DONE', milestoneId: discovery.id, assigneeId: owner.id },
    { title: 'Draft sitemap', status: 'DONE', milestoneId: discovery.id, assigneeId: sam.id },
    { title: 'Moodboard & visual direction', status: 'DONE', milestoneId: design.id, assigneeId: sam.id },
    { title: 'Homepage hero concepts', status: 'IN_REVIEW', milestoneId: design.id, assigneeId: sam.id },
    { title: 'Send brand assets (logo files, fonts)', status: 'TODO', milestoneId: design.id, assigneeId: null },
    { title: 'Internal: estimate CMS hours', status: 'IN_PROGRESS', milestoneId: null, assigneeId: owner.id, clientVisible: false },
    { title: 'Set up staging environment', status: 'TODO', milestoneId: null, assigneeId: sam.id },
  ] as const;
  let pos = 0;
  const createdTasks = [];
  for (const t of tasks) {
    createdTasks.push(
      await prisma.task.create({
        data: {
          projectId: web.id,
          title: t.title,
          status: t.status,
          milestoneId: t.milestoneId,
          assigneeId: t.assigneeId,
          clientVisible: 'clientVisible' in t ? t.clientVisible : true,
          position: pos++,
          dueDate: day(pos * 3 - 6),
          description: t.title.startsWith('Send brand')
            ? 'Please upload your logo (SVG/PNG), brand fonts and any existing style guide here.'
            : '',
        },
      }),
    );
  }

  const hero = createdTasks[3]!;
  await prisma.comment.createMany({
    data: [
      { projectId: web.id, authorId: owner.id, body: 'Welcome to your project portal, Chris! All files, approvals and invoices live here.', createdAt: day(-14) },
      { projectId: web.id, authorId: clientUser.id, body: 'Thanks Olivia — this is so much easier than email 🙌', createdAt: day(-13) },
      { projectId: web.id, taskId: hero.id, authorId: sam.id, body: 'Uploaded two hero directions. Option B uses the new illustration style.', createdAt: day(-1) },
      { projectId: web.id, taskId: hero.id, authorId: clientUser.id, body: 'Love option B! Could we try a darker background?', createdAt: day(0) },
    ],
  });

  const act = (actorId: string, verb: string, summary: string, createdAt: Date) =>
    prisma.activity.create({ data: { projectId: web.id, actorId, verb, summary, createdAt } });
  await act(owner.id, 'created', 'created the project', day(-15));
  await act(clientUser.id, 'approved', `approved “${discovery.title}”`, day(-11));
  await act(sam.id, 'submitted', `submitted “${design.title}” for approval`, day(-1));

  // ── Globex project ──
  const gx = await prisma.project.create({
    data: { orgId: org.id, clientId: globex.id, name: 'Q4 Ad Campaign', description: 'Paid social creatives for the Q4 launch.', dueDate: day(20) },
  });
  await prisma.milestone.create({ data: { projectId: gx.id, title: 'Creative concepts', status: 'IN_PROGRESS', dueDate: day(7) } });
  await prisma.task.create({ data: { projectId: gx.id, title: 'Storyboard 15s video', status: 'IN_PROGRESS', assigneeId: sam.id } });

  // ── Invoices ──
  await prisma.invoice.create({
    data: {
      orgId: org.id,
      clientId: acme.id,
      projectId: web.id,
      number: 'INV-0001',
      status: 'PAID',
      issuedAt: day(-12),
      paidAt: day(-9),
      dueDate: day(-5),
      notes: 'Thank you for your business!',
      items: { create: [{ description: 'Discovery & sitemap (50% deposit)', quantity: 1, unitAmount: 250000, position: 0 }] },
    },
  });
  await prisma.invoice.create({
    data: {
      orgId: org.id,
      clientId: acme.id,
      projectId: web.id,
      number: 'INV-0002',
      status: 'OPEN',
      issuedAt: day(-1),
      dueDate: day(14),
      notes: 'Payment due within 14 days. Thank you!',
      items: {
        create: [
          { description: 'Homepage design', quantity: 1, unitAmount: 180000, position: 0 },
          { description: 'Additional revision rounds', quantity: 2, unitAmount: 25000, position: 1 },
        ],
      },
    },
  });

  await prisma.notification.create({
    data: {
      userId: clientUser.id,
      type: 'milestone.submitted',
      title: `Approval needed: ${design.title}`,
      body: 'Sam Patel submitted this milestone for your review.',
      link: `/projects/${web.id}?milestone=${design.id}`,
    },
  });

  console.log('✅ Seeded demo workspace "Northwind Studio"');
  console.log('   owner@demo.test / password123   (agency owner)');
  console.log('   sam@demo.test / password123     (team member)');
  console.log('   client@acme.test / password123  (client: Acme Corp)');
  console.log('   maria@globex.test / password123 (client: Globex Inc)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
