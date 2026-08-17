/**
 * Q-02 -- question authoring.
 *
 * Storage format matches Admin/QuestionController::store exactly, because the
 * grading engine and any still-running Laravel screens read the same rows:
 *
 *   mcq          answer = JSON array of correct values
 *                options = JSON array of the option values
 *   fill_blanks  answer = JSON array of accepted strings, in blank order
 *   true_false   answer = the RAW string "true" or "false" (not JSON encoded)
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';
import type { QuestionType } from './grading.ts';

export interface QuestionInput {
  title: string;
  type: QuestionType;
  answer: string[] | string | boolean;
  options?: string[];
}

const COLUMNS = 'id, quiz_id, title, type, answer, options, sort, created_at, updated_at';

export class QuestionsService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async listForQuiz(quizId: number) {
    const { data, error } = await this.#db
      .from('questions').select(COLUMNS).eq('quiz_id', quizId).order('sort');
    if (error) throw new HttpError(500, `questions.list failed: ${error.message}`);
    return (data ?? []).map((q) => this.#decode(q));
  }

  /** Same shape as listForQuiz but with answers stripped, for the student. */
  async listForAttempt(quizId: number) {
    return (await this.listForQuiz(quizId)).map((q) => {
      const row = { ...(q as Record<string, unknown>) };
      delete row['answer'];   // never ship the answer key to the student
      return row;
    });
  }

  async create(quizId: number, input: QuestionInput) {
    this.#validate(input);
    const { data: siblings } = await this.#db.from('questions').select('id').eq('quiz_id', quizId);
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('questions').insert({
      quiz_id: quizId,
      title: input.title.trim(),
      type: input.type,
      ...this.#encode(input),
      sort: (siblings?.length ?? 0) + 1,
      created_at: now, updated_at: now,
    }).select(COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, `questions.create failed: ${error.message}`);
    return this.#decode(data!);
  }

  async update(id: number, input: QuestionInput) {
    this.#validate(input);
    const { error } = await this.#db.from('questions').update({
      title: input.title.trim(), type: input.type,
      ...this.#encode(input), updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new HttpError(500, `questions.update failed: ${error.message}`);
  }

  async remove(id: number): Promise<void> {
    const { error } = await this.#db.from('questions').delete().eq('id', id);
    if (error) throw new HttpError(500, `questions.delete failed: ${error.message}`);
  }

  async sort(orderedIds: number[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.#db.from('questions').update({ sort: i + 1 }).eq('id', orderedIds[i]!);
    }
  }

  #validate(input: QuestionInput) {
    const errors: Record<string, string[]> = {};
    if (!input.title?.trim()) errors['title'] = ['A question title is required.'];
    if (!['mcq', 'fill_blanks', 'true_false'].includes(input.type)) {
      errors['type'] = ['Unsupported question type.'];
    }
    if (input.type === 'mcq' && (!input.options || input.options.length < 2)) {
      errors['options'] = ['When type is MCQ, options are required.'];
    }
    const answers = Array.isArray(input.answer) ? input.answer : [input.answer];
    if (answers.length === 0 || answers.every((a) => a === '' || a == null)) {
      errors['answer'] = ['An answer is required.'];
    }
    // An MCQ answer that is not one of the options can never be selected.
    if (input.type === 'mcq' && input.options) {
      const unknown = (Array.isArray(input.answer) ? input.answer : [String(input.answer)])
        .filter((a) => !input.options!.includes(String(a)));
      if (unknown.length) errors['answer'] = ['Answer must be one of the options.'];
    }
    if (Object.keys(errors).length) {
      throw new HttpError(422, 'The given data was invalid.', { errors });
    }
  }

  #encode(input: QuestionInput): Record<string, unknown> {
    if (input.type === 'true_false') {
      // Stored raw, exactly as Laravel wrote it.
      return { answer: String(input.answer), options: null };
    }
    const answers = Array.isArray(input.answer) ? input.answer : [String(input.answer)];
    return {
      answer: phpJsonEncode(answers.map(String)),
      options: input.type === 'mcq' ? phpJsonEncode(input.options ?? []) : null,
    };
  }

  #decode(q: Record<string, unknown>) {
    return {
      ...q,
      options: phpJsonDecode<string[]>(q['options'] as string, []),
    };
  }
}
