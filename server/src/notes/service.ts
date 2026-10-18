import { User } from '../auth/user.model.js';
import { PatientNote, type PatientNoteDoc } from './patient-note.model.js';

export interface NoteItem {
  id: string;
  at: Date;
  text: string;
  author: { name: string };
}

export async function toNoteItems(notes: PatientNoteDoc[]): Promise<NoteItem[]> {
  const users = await User.find({ _id: { $in: notes.map((n) => n.authorId) } });
  return notes.map((n) => ({
    id: n.id as string,
    at: n.at,
    text: n.text,
    author: { name: users.find((u) => String(u._id) === String(n.authorId))?.name ?? '' },
  }));
}

/** Patient notes written at or after `since`, newest first. */
export async function recentNotesFor(patientId: unknown, since: Date): Promise<NoteItem[]> {
  return toNoteItems(await PatientNote.find({ patientId, at: { $gte: since } }).sort({ at: -1, _id: -1 }));
}
