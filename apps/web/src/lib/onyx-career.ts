/** Shapes the Career pages read. */

export interface Verification {
  valid: boolean;
  reason: 'valid' | 'revoked' | 'expired' | 'not_found';
  credential_id?: string;
  title?: string;
  /** The holder's name, and nothing else about them. */
  holder?: string | null;
  issuer?: string | null;
  issued_at?: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  detail?: Record<string, unknown>;
}

export interface Certificate {
  id: number; credential_id: string; title: string; kind: string;
  issued_at: string; expires_at: string | null;
  revoked_at: string | null; detail: Record<string, unknown>;
  /** Present on the institution's register; the holder's own list is all theirs. */
  user_id?: string;
  revoked_reason?: string | null;
  course_id?: number | null;
  assessment_id?: number | null;
}

export interface SkillEntry {
  skill_id: number; name: string; category: string | null;
  level: number; evidence_count: number;
  evidence: {
    source_type: string; source_id: number | null;
    strength: number; earned_at: string; detail: unknown;
  }[];
}

export interface ReadinessComponent {
  key: string; label: string; weight: number;
  raw: number; points: number; detail: Record<string, number>;
}

export interface Readiness {
  user_id: string; score: number;
  breakdown: ReadinessComponent[];
  formula: Record<string, number>;
  computed_at: string;
}

export interface Profile {
  user_id: string;
  readiness: Readiness;
  skills: SkillEntry[];
  certificates: { id: number; credential_id: string; title: string; kind: string;
    issued_at: string; detail: Record<string, unknown> }[];
}

export interface Employer {
  id: number; name: string; website: string | null; about: string | null;
  contact_name: string | null; contact_email: string | null;
  user_id: string | null; status: number;
}

export interface JobPost {
  id: number; employer_id: number; title: string; description: string | null;
  location: string | null; compensation: string | null; openings: number;
  min_readiness: number | null; min_attendance: number | null;
  required_skills: number[]; batch_ids: number[];
  closes_at: string | null; status: 'draft' | 'open' | 'closed';
  eligibility?: Eligibility;
}

export interface Eligibility {
  eligible: boolean;
  checks: { rule: string; required: string; actual: string; met: boolean }[];
}

export interface Application {
  id: number; job_id: number; user_id: string; status: string;
  note: string | null; readiness_at_apply: number | null;
  decided_at: string | null; created_at: string;
  job?: JobPost | null;
  /** Present on the employer's view: applying is sharing these with them. */
  candidate?: { name: string; email: string } | null;
}

export interface Drive {
  id: number; employer_id: number; job_id: number | null;
  title: string; scheduled_at: string | null; venue: string | null; status: string;
}

export interface DriveSummary {
  drive: Drive;
  rounds: { round_id: number; name: string; sort: number;
    attended: number; absent: number; passed: number; failed: number }[];
  cleared_final_round: number;
  offers: number;
  reconciles: boolean;
  offered_without_clearing: string[];
  cleared_without_offer: string[];
}

export interface Contest {
  id: number; title: string; description: string | null;
  starts_at: string; ends_at: string;
  problems: { problem_id: number; points: number }[];
  team_size: number; penalty_minutes: number; freeze_minutes: number;
  status: 'draft' | 'published' | 'judged';
  my_team?: { id: number; team_id: number } | null;
  teams?: { id: number; name: string }[];
}

export interface LeaderboardRow {
  rank: number; team_id: number; name: string;
  solved: number; points: number; penalty: number; last_solve_minute: number;
  problems: { problem_id: number; solved: boolean; attempts: number; at_minute: number | null }[];
}

export interface Leaderboard {
  frozen: boolean;
  frozen_after_minute: number | null;
  rows: LeaderboardRow[];
}

export interface Interview {
  id: number; title: string; scheduled_at: string; duration_minutes: number;
  status: string; join_url?: string | null;
  feedback: { criterion: string; score: number; of: number; comment?: string | null }[] | null;
  overall: number | null;
  notes: string | null;
  has_recording?: boolean;
  feedback_released: boolean;
  user_id?: string;
  interviewer_id?: string | null;
}

/** Who runs placement. Employers are outsiders and are never in this list. */
export const isPlacementStaff = (role: string) => role === 'admin' || role === 'placement';

export const APPLICATION_LABELS: Record<string, string> = {
  applied: 'Applied',
  shortlisted: 'Shortlisted',
  interviewing: 'Interviewing',
  offered: 'Offered',
  hired: 'Hired',
  rejected: 'Not taken forward',
  withdrawn: 'Withdrawn',
};
