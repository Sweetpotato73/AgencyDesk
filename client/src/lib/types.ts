export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'CLIENT';
export type ProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
export type MilestoneStatus = 'PENDING' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'CHANGES_REQUESTED' | 'APPROVED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID';

export interface Brand {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  currency: string;
  logoUrl: string | null;
}

export interface Session {
  user: { id: string; name: string; email: string; role: Role; clientId: string | null };
  org: Brand;
  client: { id: string; name: string } | null;
  features: { stripe: boolean; storage: 's3' | 'local'; maxUploadBytes: number };
}

export interface UserLite {
  id: string;
  name: string;
  email?: string;
  role: Role;
}

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  _count?: { projects: number; users: number };
  outstanding?: number;
}

export interface ClientDetail extends Client {
  users: (UserLite & { createdAt: string; lastSeenAt: string | null })[];
  invites: { id: string; email: string; createdAt: string; expiresAt: string }[];
  projects: { id: string; name: string; status: ProjectStatus; dueDate: string | null }[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  dueDate: string | null;
  updatedAt: string;
  client: { id: string; name: string };
  milestoneCount: number;
  milestonesApproved: number;
  awaitingApproval: number;
  taskCount: number;
  tasksDone: number;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  dueDate: string | null;
  position: number;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedById: string | null;
  decisionNote: string | null;
  taskCount: number;
  tasksDone: number;
  fileCount: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  dueDate: string | null;
  clientId: string;
  client: { id: string; name: string };
  milestones: Milestone[];
  team: UserLite[];
}

export interface Task {
  id: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeId: string | null;
  dueDate: string | null;
  clientVisible: boolean;
  position: number;
  assignee: UserLite | null;
  milestone: { id: string; title: string } | null;
  _count: { comments: number; files: number };
}

export interface TaskDetail extends Task {
  files: FileItem[];
}

export interface Comment {
  id: string;
  projectId: string;
  taskId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  author: { id: string; name: string; role: Role };
}

export interface FileItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  projectId: string;
  taskId: string | null;
  milestoneId: string | null;
  uploader: { id: string; name: string; role: Role };
  task?: { id: string; title: string } | null;
  milestone?: { id: string; title: string } | null;
}

export interface InvoiceItem {
  id?: string;
  description: string;
  quantity: number;
  unitAmount: number;
}

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  dueDate: string | null;
  notes: string;
  issuedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  clientId: string;
  projectId: string | null;
  client: { id: string; name: string; email: string | null };
  project: { id: string; name: string } | null;
  items: InvoiceItem[];
  total: number;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export interface Activity {
  id: string;
  verb: string;
  summary: string;
  createdAt: string;
  actor: { id: string; name: string; role: Role };
  project?: { id: string; name: string };
}
