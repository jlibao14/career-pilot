import { pgTable, serial, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const applicationsTable = pgTable("applications", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("draft"),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url"),
  sourceText: text("source_text"),
  company: text("company"),
  roleTitle: text("role_title"),
  location: text("location"),
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  jobSummary: text("job_summary"),
  keyRequirements: jsonb("key_requirements").$type<string[]>().notNull().default([]),
  coverLetter: text("cover_letter"),
  emailSubject: text("email_subject"),
  validation: jsonb("validation").$type<{
    passed: boolean;
    checks: { id: string; label: string; passed: boolean; detail?: string | null }[];
  } | null>(),
  autoSent: boolean("auto_sent").notNull().default(false),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  agentmailMessageId: text("agentmail_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Application = typeof applicationsTable.$inferSelect;
