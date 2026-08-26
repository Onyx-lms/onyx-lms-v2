/**
 * Wires the Sprint-1 platform services together once per process.
 *
 * Note which client each service gets -- that is the P-07 boundary in practice:
 * settings and i18n read through the service client because `settings` is not
 * anon-readable (it holds smtp_pass and API keys) and phrase auto-registration
 * writes.
 */
import {
  SettingsService, I18nService, StorageService, AuthService,
  AcademicsService, ContentService, DomainsService, AttendanceService, AssignmentsService,
  QueueService, CodeLabService, WorkspaceService,
  AssessService, ProctorService, AssessAnalyticsService,
  CareerService, PlacementService, ContestService, ResumeService,
  EngageService, SupportService, CampusService, ExaminationsService,
  FinanceService, OnyxCheckoutService, GuardianService, PlatformService, OnyxSectionsService,
  NotifyService,
  executionProviderFromEnv, runCodeLabWorker,
  type ExecutionProvider, type CodeLabWorkerOptions,
  RegistrationService, VerificationService, PasswordResetService,
  PermissionsService, ProfileService, UsersService, DeviceIpService,
  CategoriesService, CoursesService, SeoService, InstructorsService,
  ContactService, NewsletterService,
  CourseBuilderService, SectionsService, LessonsService,
  MailService, MediaService,
  QuestionsService, QuizService,
  EnrollmentService, CouponService, CartService, WishlistService,
  PaymentService, OfflinePaymentService,
  WatchService, PlayerService, PlayerSettingsService,
  CertificateService, ForumService, ReviewService, InstructorReviewService,
  MessagingService, LiveClassService, ZoomService, CompareService,
  BootcampService, BootcampModuleService, BootcampResourceService,
  BootcampClassService, BootcampPurchaseService,
  TeamPackageService, TeamMemberService,
  TutorCatalogService, TutorScheduleService, TutorBookingService,
  RevenueService, PayoutService,
  SettingsAdminService, PlatformAdminService, CampaignService,
  TenancyService, AuditService, onyxServiceClient, OAuthClientsService,
  BlogService, BlogEngagementService, KnowledgeBaseService, TestimonialService,
  RateLimiter, SupabaseRateLimitStore, serviceClient, anonClient, type Db,
} from '@onyx/core';

export interface AppContext {
  db: Db;
  publicDb: Db;
  settings: SettingsService;
  i18n: I18nService;
  storage: StorageService;
  auth: AuthService;
  registration: RegistrationService;
  verification: VerificationService;
  passwordReset: PasswordResetService;
  permissions: PermissionsService;
  profiles: ProfileService;
  users: UsersService;
  deviceIps: DeviceIpService;
  categories: CategoriesService;
  courses: CoursesService;
  seo: SeoService;
  instructors: InstructorsService;
  contact: ContactService;
  newsletter: NewsletterService;
  builder: CourseBuilderService;
  sections: SectionsService;
  lessons: LessonsService;
  watch: WatchService;
  player: PlayerService;
  playerSettings: PlayerSettingsService;
  certificates: CertificateService;
  forum: ForumService;
  reviews: ReviewService;
  instructorReviews: InstructorReviewService;
  blog: BlogService;
  blogEngagement: BlogEngagementService;
  knowledgeBase: KnowledgeBaseService;
  testimonials: TestimonialService;
  messaging: MessagingService;
  liveClasses: LiveClassService;
  compare: CompareService;
  bootcamps: BootcampService;
  bootcampModules: BootcampModuleService;
  bootcampResources: BootcampResourceService;
  bootcampClasses: BootcampClassService;
  bootcampPurchases: BootcampPurchaseService;
  teamPackages: TeamPackageService;
  teamMembers: TeamMemberService;
  tutorCatalog: TutorCatalogService;
  tutorSchedules: TutorScheduleService;
  tutorBookings: TutorBookingService;
  revenue: RevenueService;
  payouts: PayoutService;
  settingsAdmin: SettingsAdminService;
  platformAdmin: PlatformAdminService;
  campaigns: CampaignService;
  // Onyx (ADR-006): a separate product, on `onyx_`-prefixed tables.
  onyxTenancy: TenancyService;
  onyxAudit: AuditService;
  onyxAcademics: AcademicsService;
  onyxContent: ContentService;
  onyxDomains: DomainsService;
  onyxAttendance: AttendanceService;
  onyxAssignments: AssignmentsService;
  onyxQueue: QueueService;
  onyxExecution: ExecutionProvider;
  onyxCodeLab: CodeLabService;
  onyxWorkspaces: WorkspaceService;
  onyxAssess: AssessService;
  onyxProctor: ProctorService;
  onyxAssessAnalytics: AssessAnalyticsService;
  onyxCareer: CareerService;
  onyxResume: ResumeService;
  onyxPlacement: PlacementService;
  onyxContests: ContestService;
  onyxEngage: EngageService;
  onyxSupport: SupportService;
  onyxCampus: CampusService;
  onyxExams: ExaminationsService;
  onyxNotify: NotifyService;
  onyxFinance: FinanceService;
  onyxCheckout: OnyxCheckoutService;
  onyxGuardians: GuardianService;
  onyxPlatform: PlatformService;
  onyxSections: OnyxSectionsService;
  onyxOAuthClients: OAuthClientsService;
  /** One pass of the Code Lab worker. Also driven by an interval in server.ts. */
  onyxRunWorker: (opts?: CodeLabWorkerOptions) =>
    Promise<{ done: number; retried: number; failed: number }>;
  zoom: ZoomService;
  payments: PaymentService;
  offline: OfflinePaymentService;
  enrollment: EnrollmentService;
  coupons: CouponService;
  cart: CartService;
  wishlist: WishlistService;
  questions: QuestionsService;
  quiz: QuizService;
  mail: MailService;
  media: MediaService;
  webOrigin: string;
  limiter: RateLimiter;
  jwtSecret: string;
}

export function createContext(): AppContext {
  const db = serviceClient();
  const settings = new SettingsService(db);
  const mail = new MailService(settings);
  const onyxDb = onyxServiceClient();
  const onyxAcademics = new AcademicsService(onyxDb);
  // Teaching divisions -- Alpha/Beta/Gamma, Section A/B/C. One small table
  // and one column on memberships; see 0038 for why it is not a batch.
  const onyxSections = new OnyxSectionsService(onyxDb);
  // Hoisted because the proctoring service records invigilator decisions
  // through it; a second instance would work but would be a second thing to
  // configure identically.
  const onyxAudit = new AuditService(onyxDb, (m) => console.error('[onyx] ' + m));
  // LAB-02b. The queue is the one part of Onyx that talks to Postgres directly:
  // claiming work is a single FOR UPDATE SKIP LOCKED statement, and PostgREST
  // cannot express it.
  const onyxQueue = new QueueService(onyxDb, 'api-' + process.pid);
  // LAB-02a. Unconfigured is a first-class outcome -- the bank, the queue and
  // a workspace's files, snapshots and review all work without a sandbox;
  // only running code, in either place, does not.
  const onyxExecution = executionProviderFromEnv();
  const onyxCodeLab = new CodeLabService(onyxDb, onyxAcademics, onyxQueue, onyxExecution);
  /*
   * Hoisted to a local because the platform service is handed it.
   *
   * Cancelling a paper is refused once somebody has sat it, and that rule
   * lives here rather than in the console's own service -- otherwise it
   * exists twice and one copy drifts. The console needs the same object,
   * not a second one built from the same arguments.
   */
  const onyxAssess = new AssessService(onyxDb, onyxAcademics, Date.now, onyxCodeLab);

  const onyxAttendance = new AttendanceService(onyxDb, onyxAcademics);
  // Career reads across everything before it -- attendance, assessment,
  // practice, projects -- which is what makes a readiness score mean anything.
  const onyxCareer = new CareerService(onyxDb, onyxAcademics, onyxAttendance);
  // Named rather than inlined, because the resume assembles from all four of
  // these and re-constructing any of them would mean two objects answering the
  // same question -- which is the shape of bug where a cache on one of them
  // starts disagreeing with itself.
  const onyxWorkspaceService = new WorkspaceService(onyxDb, onyxAcademics, onyxExecution);
  // CMP-02. Guardians read published marks through this rather than
  // querying onyx_exam_marks themselves, so the 'published only' rule
  // lives in one place.
  // Mail is the port's, reused wholesale: SMTP settings, transport caching
  // and the fail-soft behaviour are all already right there.
  const onyxNotify = new NotifyService(onyxDb, {
    mail,
    onError: (m) => console.error('[onyx] ' + m),
  });

  /*
   * Proctoring is told HOW a paper is stopped, rather than importing it.
   *
   * The rule -- warn twice, stop on the third departure -- is decided in
   * ProctorService, where the departures are counted. Ending the attempt is
   * AssessService's job: it owns the paper, the clock and the scoring.
   * Importing either into the other would make the two a cycle, so they are
   * introduced here, where both already exist. Without this line proctoring
   * behaves exactly as it did before the rule existed -- it records, and stops
   * nothing.
   */
  const onyxProctor = new ProctorService(onyxDb, onyxAudit, Date.now, onyxNotify);
  onyxProctor.useStopper(onyxAssess);

  const onyxExams = new ExaminationsService(onyxDb, onyxAudit);
  // Hoisted: the checkout service settles through it, so both need the
  // same instance rather than two with separate audit wiring.
  const onyxFinance = new FinanceService(onyxDb, onyxAudit);
  const bootcampPurchases = new BootcampPurchaseService(db, settings);
  const teamMembers = new TeamMemberService(db, settings);
  const revenue = new RevenueService(db);
  const categories = new CategoriesService(db);
  const storage = new StorageService(db);
  // Named rather than inlined below: the checkout service settles Live Class
  // registrations through it, and two instances would be two objects answering
  // the same question about the same rows.
  const onyxDomainsService = new DomainsService(onyxDb, storage);
  // Storage, because a person can now upload their own profile picture. Built
  // here rather than earlier for the same reason DomainsService is: `storage`
  // does not exist further up.
  const onyxTenancyService = new TenancyService(onyxDb, undefined, undefined, storage);
  const enrollment = new EnrollmentService(db);
  const coupons = new CouponService(db);
  const cart = new CartService(db, enrollment, coupons);
  const payments = new PaymentService(db, settings, cart, enrollment);
  const watch = new WatchService(db);
  const playerSettings = new PlayerSettingsService(db, settings, storage);
  return {
    db,
    publicDb: anonClient(),
    settings,
    i18n: new I18nService(db),
    storage,
    auth: new AuthService(db),
    registration: new RegistrationService(db),
    verification: new VerificationService(db),
    passwordReset: new PasswordResetService(db),
    permissions: new PermissionsService(db),
    profiles: new ProfileService(db),
    users: new UsersService(db),
    deviceIps: new DeviceIpService(db),
    categories,
    courses: new CoursesService(db, categories),
    seo: new SeoService(db, settings),
    instructors: new InstructorsService(db),
    contact: new ContactService(db, mail, settings),
    newsletter: new NewsletterService(db),
    builder: new CourseBuilderService(db),
    sections: new SectionsService(db),
    lessons: new LessonsService(db),
    watch,
    player: new PlayerService(db, enrollment, watch, storage, playerSettings),
    playerSettings,
    certificates: new CertificateService(db, settings),
    forum: new ForumService(db),
    reviews: new ReviewService(db),
    instructorReviews: new InstructorReviewService(db),
    blog: new BlogService(db, settings),
    blogEngagement: new BlogEngagementService(db),
    knowledgeBase: new KnowledgeBaseService(db),
    testimonials: new TestimonialService(db),
    messaging: new MessagingService(db),
    liveClasses: new LiveClassService(db),
    compare: new CompareService(db),
    bootcamps: new BootcampService(db),
    bootcampModules: new BootcampModuleService(db),
    bootcampResources: new BootcampResourceService(db),
    bootcampClasses: new BootcampClassService(db),
    bootcampPurchases,
    teamPackages: new TeamPackageService(db),
    teamMembers,
    tutorCatalog: new TutorCatalogService(db),
    tutorSchedules: new TutorScheduleService(db),
    tutorBookings: new TutorBookingService(db, settings),
    revenue,
    payouts: new PayoutService(db, revenue),
    settingsAdmin: new SettingsAdminService(db, settings),
    platformAdmin: new PlatformAdminService(db),
    campaigns: new CampaignService(db, settings, mail),
    onyxTenancy: onyxTenancyService,
    onyxAudit,
    onyxAcademics,
    // Onyx shares the port's bucket -- storage is per project, not per schema --
    // and namespaces its own files under onyx/<tenant>/.
    onyxContent: new ContentService(onyxDb, onyxAcademics, storage),
    onyxDomains: onyxDomainsService,
    onyxAttendance,
    onyxAssignments: new AssignmentsService(onyxDb, onyxAcademics),
    onyxQueue,
    onyxExecution,
    onyxCodeLab,
    onyxWorkspaces: onyxWorkspaceService,
    // The Code Lab service doubles as the grader for `code` questions, so a
    // coding question on a paper is marked by exactly the same tests, in the
    // same sandbox, as the practice problem it points at -- rather than by a
    // second implementation that could disagree with the first.
    onyxAssess,
    // The notifier is what turns a crossed threshold into something an
    // invigilator is told rather than something they must go and find. It is
    // the fourth argument; the third is the clock, stated explicitly here so
    // the two cannot be transposed again.
    onyxProctor,
    onyxAssessAnalytics: new AssessAnalyticsService(onyxDb),
    onyxCareer,
    onyxResume: new ResumeService(onyxDb, {
      academics: onyxAcademics, career: onyxCareer,
      tenancy: onyxTenancyService, workspaces: onyxWorkspaceService,
    }),
    onyxPlacement: new PlacementService(onyxDb, onyxCareer, onyxAttendance),
    onyxContests: new ContestService(onyxDb),
    onyxEngage: new EngageService(onyxDb, onyxAcademics, onyxAudit),
    onyxSupport: new SupportService(onyxDb, onyxAudit),
    onyxCampus: new CampusService(onyxDb, onyxAudit),
    onyxExams,
    onyxNotify,
    onyxFinance: onyxFinance,
    onyxCheckout: new OnyxCheckoutService(onyxDb, onyxFinance, {
      secret: process.env.SUPABASE_JWT_SECRET ?? '',
      // Needed to settle a course sale, which writes to onyx_course_purchases
      // rather than raising an invoice (see 0024's header).
      academics: onyxAcademics,
      // And a Live Class registration, which writes to its own table for the
      // reason 0030's header repeats.
      domains: onyxDomainsService,
      // WEB_ORIGIN as the fallback, because it is the same fact under a
      // second name: where this deployment is reachable. It is what the
      // verification-email links and the certificate QR codes are built from
      // and it is the one that is actually set in production, while WEB_URL
      // was read here and set nowhere -- so every gateway return URL pointed
      // at 127.0.0.1:5173, which is a payer being sent back to a page on
      // their own machine.
      baseUrl: process.env.WEB_URL || process.env.WEB_ORIGIN,   // || not ??: blank means unset
      /*
       * The platform's own merchant account, used by every institution that
       * has not configured one of its own.
       *
       * Onyx sells on behalf of the institutions rather than as them, so there
       * is one Razorpay account and not nine. From the environment rather than
       * a row, because a live secret in a table is a live secret in every
       * backup of that table -- and because an institution created tomorrow
       * has to be able to sell without anybody remembering to paste a key in.
       *
       * Unset in a deployment that sells nothing, and then every Buy button
       * opens the mock dialog and says on it that no money moved.
       */
      defaults: process.env.RAZORPAY_KEY_ID ? [{
        identifier: 'razorpay',
        title: 'Razorpay',
        currency: process.env.RAZORPAY_CURRENCY || 'INR',
        keys: {
          razorpay_key: process.env.RAZORPAY_KEY_ID,
          razorpay_secret: process.env.RAZORPAY_KEY_SECRET ?? '',
          // Without this `parseWebhook` returns null at its first line and
          // every webhook silently no-ops, which is only survivable because
          // the redirect path also settles. Set it and both work.
          ...(process.env.RAZORPAY_WEBHOOK_SECRET
            ? { razorpay_webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET } : {}),
        },
      }] : [],
    }),
    onyxGuardians: new GuardianService(onyxDb, onyxAudit, onyxExams),
    // `onyxTenancyService` so the console can read and set an institution's
    // registration policy through the one place that parses a domain list.
    onyxPlatform: new PlatformService(onyxDb, undefined, onyxAssess, onyxTenancyService),
    onyxSections,
    onyxOAuthClients: new OAuthClientsService(),
    onyxRunWorker: (opts) => runCodeLabWorker(onyxQueue, onyxCodeLab, {
      ...opts, onError: (m) => console.error('[onyx] ' + m),
    }),
    zoom: new ZoomService(settings),
    payments,
    offline: new OfflinePaymentService(db, settings, cart, payments,
      process.env.SUPABASE_JWT_SECRET ?? '', bootcampPurchases, teamMembers),
    enrollment,
    coupons,
    cart,
    wishlist: new WishlistService(db),
    questions: new QuestionsService(db),
    quiz: new QuizService(db),
    mail,
    media: new MediaService(db, storage),
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    /**
     * Shared buckets, not per-process ones.
     *
     * The default store is an in-memory Map, which counted correctly for exactly
     * as long as there was one always-on API process. Serving the API from
     * serverless functions makes "six attempts per minute" mean six per minute
     * per instance -- and instances appear in response to load, i.e. in response
     * to someone attempting a lot of logins. Nothing errors when that happens,
     * which is why it has to be wired deliberately here rather than left to a
     * default. See packages/core/src/http/rate-limit.ts.
     */
    limiter: new RateLimiter(new SupabaseRateLimitStore(onyxDb)),
    jwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  };
}
