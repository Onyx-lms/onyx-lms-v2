/**
 * F-05 -- contracts for the 20 columns that store JSON as TEXT.
 *
 * These columns are `text` in Postgres because that is what they are in MySQL
 * today. Changing them to jsonb would be a schema change, which this port does
 * not do. Every read/write goes through these schemas so the shape is checked
 * at the boundary instead of blowing up three layers deep.
 */
import { z } from 'zod';

/** courses.drip_content_settings */
export const DripContentSettings = z.object({
  lesson_completion_role: z.enum(['duration', 'percentage']),
  minimum_duration: z.coerce.number().optional(),
  minimum_percentage: z.coerce.number().optional(),
});
export type DripContentSettings = z.infer<typeof DripContentSettings>;

/** watch_histories.completed_lesson -- array of lesson ids */
export const CompletedLessons = z.array(z.coerce.number());

/** watch_durations.watched_counter -- array of 5s tick markers.
 *  Ported verbatim; see ADR-003 for why the format is not being redesigned. */
export const WatchedCounter = z.array(z.union([z.string(), z.number()]));

/** permissions.permissions -- allow-list of route names for a sub-admin */
export const PermissionList = z.array(z.string());

/** questions.answer / questions.options */
export const QuestionOptions = z.array(z.string());
export const QuestionAnswer = z.union([z.array(z.string()), z.boolean(), z.string()]);

/** users.educations */
export const Educations = z.array(z.object({
  degree: z.string().optional(),
  institute: z.string().optional(),
  year: z.string().optional(),
}).passthrough());

/** users.social_links */
export const SocialLinks = z.record(z.string()).or(z.array(z.string()));

/** courses.instructor_ids */
export const InstructorIds = z.array(z.coerce.number()).or(z.string());

/** payment_gateways.keys -- shape differs per provider, so stay permissive */
export const GatewayKeys = z.record(z.union([z.string(), z.number(), z.null()]));

export const JSON_TEXT_COLUMNS = [
  'courses.drip_content_settings', 'courses.instructor_ids',
  'watch_histories.completed_lesson', 'watch_durations.watched_counter',
  'permissions.permissions', 'questions.answer', 'questions.options',
  'users.social_links', 'users.educations', 'users.skills',
  'team_training_packages.features', 'tutor_bookings.payment_details',
  'team_package_purchases.payment_details', 'payouts.payment_details',
  'payment_gateways.keys', 'live_classes.additional_info',
  'bootcamp_live_classes.joining_data', 'tutor_bookings.joining_data',
  'offline_payments.items', 'seo_fields.json_ld',
] as const;
