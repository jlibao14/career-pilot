import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const profileTable = pgTable("profile", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone"),
  location: text("location"),
  linkedin: text("linkedin"),
  website: text("website"),
  headline: text("headline"),
  summary: text("summary"),
  preferredTone: text("preferred_tone"),
  keyAchievements: text("key_achievements"),
  resumeObjectPath: text("resume_object_path"),
  resumeFileName: text("resume_file_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Profile = typeof profileTable.$inferSelect;
