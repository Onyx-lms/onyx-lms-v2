import { FakeDb } from './fake-db.ts';

/** Fixture mirroring the real column shapes, shared by the S03 test files. */
export const seed = () => new FakeDb({
  categories: [
    { id: 1, parent_id: 0, title: 'Development', slug: 'development', sort: 1, status: 1 },
    { id: 2, parent_id: 1, title: 'Web', slug: 'web', sort: 1, status: 1 },
    { id: 3, parent_id: 1, title: 'Mobile', slug: 'mobile', sort: 2, status: 1 },
    { id: 4, parent_id: 0, title: 'Design', slug: 'design', sort: 2, status: 1 },
  ],
  courses: [
    { id: 10, title: 'React Basics', slug: 'react-basics', status: 'active', category_id: 2,
      user_id: 100, is_paid: 1, price: 49.5, discount_flag: 0, level: 'beginner',
      language: 'english', short_description: 'Learn React', description: 'deep dive',
      requirements: '["A laptop"]', outcomes: '["Build apps"]', faqs: '[]' },
    { id: 11, title: 'Flutter Intro', slug: 'flutter-intro', status: 'active', category_id: 3,
      user_id: 100, is_paid: 0, price: null, discount_flag: 0, level: 'beginner',
      language: 'english', short_description: 'Mobile apps' },
    { id: 12, title: 'Figma Mastery', slug: 'figma-mastery', status: 'active', category_id: 4,
      user_id: 101, is_paid: 1, price: 80, discount_flag: 1, discounted_price: 40,
      level: 'advanced', language: 'spanish', short_description: 'Design systems' },
    { id: 13, title: 'Draft Course', slug: 'draft-course', status: 'draft', category_id: 2,
      user_id: 100, is_paid: 1, price: 10, level: 'beginner', language: 'english' },
  ],
  users: [
    { id: 100, name: 'Grace Hopper', role: 'instructor', photo: 'p1.png', skills: '["php"]' },
    { id: 101, name: 'Ada Lovelace', role: 'instructor', photo: 'p2.png', skills: null },
    { id: 102, name: 'Sam Student', role: 'student' },
  ],
  sections: [{ id: 1, course_id: 10, title: 'Getting started', sort: 1 }],
  lessons: [
    { id: 1, course_id: 10, section_id: 1, title: 'Intro', lesson_type: 'video', is_free: 1, sort: 1 },
    { id: 2, course_id: 10, section_id: 1, title: 'JSX', lesson_type: 'video', is_free: 0, sort: 2 },
  ],
  enrollments: [{ id: 1, course_id: 10, user_id: 102 }],
  reviews: [
    { id: 1, course_id: 10, user_id: 102, rating: 5 },
    { id: 2, course_id: 10, user_id: 103, rating: 4 },
  ],
  instructor_reviews: [{ id: 1, instructor_id: 100, rating: 5 }],
  seo_fields: [
    { id: 1, route: 'courses', meta_title: 'All Courses', meta_description: 'Browse',
      meta_keywords: 'courses', og_title: null, og_description: null, og_image: null,
      meta_robot: null, canonical_url: null, json_ld: null,
      course_id: null, blog_id: null, bootcamp_id: null },
    { id: 2, route: null, meta_title: 'React Basics SEO', meta_description: 'React SEO desc',
      meta_keywords: null, og_title: null, og_description: null, og_image: null,
      meta_robot: null, canonical_url: null, json_ld: null,
      course_id: 10, blog_id: null, bootcamp_id: null },
  ],
  settings: [
    { id: 1, type: 'meta_title', description: 'EZiL Certify' },
    { id: 2, type: 'meta_description', description: 'Site wide description' },
    { id: 3, type: 'meta_keywords', description: 'lms, courses' },
  ],
  contacts: [],
  newsletter_subscribers: [],
});
