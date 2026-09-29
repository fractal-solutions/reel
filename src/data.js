import { SQL } from "bun";
export const DEMO_USER_ID = 1;
export const DEMO_CREATOR_ID = 1;
const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    avatar_url TEXT, role TEXT NOT NULL DEFAULT 'viewer', region TEXT, language TEXT DEFAULT 'en',
    is_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE,
    description TEXT, icon_url TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS films (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, poster_url TEXT,
    trailer_url TEXT, video_url TEXT, duration INTEGER, genre TEXT, region TEXT, language TEXT,
    rating REAL, review_count INTEGER NOT NULL DEFAULT 0, view_count INTEGER NOT NULL DEFAULT 0,
    monetization TEXT NOT NULL DEFAULT 'free' CHECK (monetization IN ('free','pay_per_view','subscription','ad_supported')),
    price REAL, is_festival_winner INTEGER NOT NULL DEFAULT 0, is_featured INTEGER NOT NULL DEFAULT 0,
    creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cast TEXT, director TEXT, status TEXT NOT NULL DEFAULT 'published'
      CHECK (status IN ('draft','pending','published','rejected')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS film_categories (
    film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (film_id, category_id)
  )`,
  `CREATE TABLE IF NOT EXISTS film_tags (
    film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    tag TEXT NOT NULL, PRIMARY KEY (film_id, tag)
  )`,
  `CREATE TABLE IF NOT EXISTS film_subtitles (
    film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    language TEXT NOT NULL, PRIMARY KEY (film_id, language)
  )`,
  `CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE, added_at TEXT NOT NULL,
    UNIQUE (user_id, film_id)
  )`,
  `CREATE TABLE IF NOT EXISTS watch_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    progress_seconds INTEGER NOT NULL DEFAULT 0, total_seconds INTEGER,
    percent_complete REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    UNIQUE (user_id, film_id)
  )`,
  `CREATE TABLE IF NOT EXISTS viewing_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL, seconds_watched INTEGER NOT NULL DEFAULT 0,
    last_position_seconds INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, film_id INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), comment TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price_monthly REAL NOT NULL,
    price_annual REAL NOT NULL, is_popular INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS plan_features (
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    feature TEXT NOT NULL, PRIMARY KEY (plan_id, feature)
  )`,
  `CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL CHECK (amount > 0), currency TEXT NOT NULL DEFAULT 'KES',
    method TEXT NOT NULL CHECK (method IN ('mpesa','bank','paypal')), account_details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
    requested_at TEXT NOT NULL, completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS films_status_created ON films(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS films_creator ON films(creator_id)`,
  `CREATE INDEX IF NOT EXISTS films_genre ON films(genre)`,
  `CREATE INDEX IF NOT EXISTS reviews_film ON reviews(film_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS progress_user_updated ON watch_progress(user_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS viewing_events_started ON viewing_events(started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS viewing_events_film ON viewing_events(film_id,started_at DESC)`
];
const seededCategories = [
  ["Drama", "drama", "Character-driven African stories"],
  ["Comedy", "comedy", "Comedies from across the continent"],
  ["Documentary", "documentary", "Documentary films and real-life stories"],
  ["Thriller", "thriller", "Suspenseful stories and mysteries"],
  ["Romance", "romance", "Stories about love and connection"],
  ["Action", "action", "Action and adventure films"]
];
const seededFilms = [
  {
    title: "The Last Baobab",
    description: "A young conservationist returns home to protect the village's ancient baobab grove.",
    posterUrl: "https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=900",
    duration: 6420,
    genre: "Drama",
    category: "Drama",
    region: "Kenya",
    language: "Swahili",
    rating: 4.8,
    reviewCount: 2,
    viewCount: 0,
    monetization: "free",
    price: null,
    festival: true,
    featured: true,
    cast: "Amina Wanjiku, Peter Kamau",
    director: "Nia Otieno",
    tags: ["family", "conservation"],
    subtitles: ["English", "French"]
  },
  {
    title: "Lagos After Rain",
    description: "Two strangers navigate a changed city after an unexpected storm.",
    posterUrl: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=900",
    duration: 5880,
    genre: "Romance",
    category: "Romance",
    region: "Nigeria",
    language: "English",
    rating: 4.6,
    reviewCount: 1,
    viewCount: 0,
    monetization: "pay_per_view",
    price: 250,
    festival: false,
    featured: true,
    cast: "Tomi Adebayo, Kelechi Nwosu",
    director: "Chinwe Eze",
    tags: ["city", "love"],
    subtitles: ["French"]
  },
  {
    title: "Market Day",
    description: "A spirited trader's plans are upended when her family joins the business.",
    posterUrl: "https://images.unsplash.com/photo-1533929736458-ca588d08c8be?w=900",
    duration: 5160,
    genre: "Comedy",
    category: "Comedy",
    region: "Ghana",
    language: "Twi",
    rating: 4.4,
    reviewCount: 0,
    viewCount: 0,
    monetization: "free",
    price: null,
    festival: false,
    featured: true,
    cast: "Akosua Mensah, Kojo Owusu",
    director: "Ama Boateng",
    tags: ["family", "market"],
    subtitles: ["English"]
  },
  {
    title: "The Salt Road",
    description: "A documentary tracing generations of salt harvesters along the coast.",
    posterUrl: "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=900",
    duration: 4380,
    genre: "Documentary",
    category: "Documentary",
    region: "Senegal",
    language: "French",
    rating: 4.9,
    reviewCount: 1,
    viewCount: 0,
    monetization: "ad_supported",
    price: null,
    festival: true,
    featured: false,
    cast: "Awa Diop",
    director: "Mamadou Fall",
    tags: ["culture", "coast"],
    subtitles: ["English", "Portuguese"]
  },
  {
    title: "Kampala Nights",
    description: "A radio host follows a mysterious caller through the city's night shift.",
    posterUrl: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=900",
    duration: 5640,
    genre: "Thriller",
    category: "Thriller",
    region: "Uganda",
    language: "English",
    rating: 4.2,
    reviewCount: 0,
    viewCount: 0,
    monetization: "pay_per_view",
    price: 180,
    festival: false,
    featured: false,
    cast: "Sarah Kintu, David Ssemanda",
    director: "Moses Kato",
    tags: ["mystery", "night"],
    subtitles: ["French"]
  },
  {
    title: "A River Between Us",
    description: "Siblings reunite to build a bridge between two communities and their own past.",
    posterUrl: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=900",
    duration: 6960,
    genre: "Drama",
    category: "Drama",
    region: "Tanzania",
    language: "Swahili",
    rating: 4.7,
    reviewCount: 0,
    viewCount: 0,
    monetization: "subscription",
    price: null,
    festival: false,
    featured: false,
    cast: "Neema Juma, Baraka Mushi",
    director: "Rehema Said",
    tags: ["family", "community"],
    subtitles: ["English"]
  },
  {
    title: "Cape of Good Hope",
    description: "A young boxer discovers that winning means more than a title.",
    posterUrl: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=900",
    duration: 6240,
    genre: "Action",
    category: "Action",
    region: "South Africa",
    language: "English",
    rating: 4.3,
    reviewCount: 0,
    viewCount: 0,
    monetization: "free",
    price: null,
    festival: true,
    featured: false,
    cast: "Lwazi Dlamini, Zanele Mokoena",
    director: "Thabo Nkosi",
    tags: ["sport", "resilience"],
    subtitles: ["Afrikaans", "French"]
  },
  {
    title: "The Talking Drum",
    description: "A sound engineer uncovers a story hidden in recordings from her hometown.",
    posterUrl: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=900",
    duration: 4740,
    genre: "Documentary",
    category: "Documentary",
    region: "Nigeria",
    language: "Yoruba",
    rating: 4.5,
    reviewCount: 0,
    viewCount: 0,
    monetization: "free",
    price: null,
    festival: false,
    featured: false,
    cast: "Bisi Adewale",
    director: "Femi Akinola",
    tags: ["music", "heritage"],
    subtitles: ["English"]
  }
];
const seededPlans = [
  { name: "Starter", monthly: 0, annual: 0, popular: 0, features: ["Free films", "Standard quality", "Watch on one device"] },
  { name: "Cinema", monthly: 499, annual: 4990, popular: 1, features: ["All subscription films", "HD streaming", "Watch on two devices"] },
  { name: "Cinema Plus", monthly: 899, annual: 8990, popular: 0, features: ["Everything in Cinema", "4K where available", "Watch on four devices"] }
];
export async function initializeDatabase(db) {
  await db`PRAGMA foreign_keys = ON`;
  for (const statement of schema)
    await db.unsafe(statement);
  const viewingColumns = await db.unsafe("PRAGMA table_info(viewing_events)");
  if (!viewingColumns.some((column) => column.name === "last_position_seconds"))
    await db.unsafe("ALTER TABLE viewing_events ADD COLUMN last_position_seconds INTEGER NOT NULL DEFAULT 0");
  await db.unsafe(`UPDATE films SET view_count=(
    SELECT COUNT(*) FROM viewing_events WHERE viewing_events.film_id=films.id
  )`);
  const now = new Date().toISOString();
  await db.unsafe(`INSERT OR IGNORE INTO users (id,name,email,avatar_url,role,region,language,is_verified,created_at,updated_at)
     VALUES (1,?,?,?,?,?,?,1,?,?)`, ["Amara Okafor", "amara@example.test", "https://i.pravatar.cc/160?img=47", "creator", "Kenya", "en", now, now]);
  await db.unsafe(`INSERT OR IGNORE INTO users (id,name,email,role,region,language,is_verified,created_at,updated_at)
     VALUES (2,?,?,?,?,?,0,?,?)`, ["Kofi Mensah", "kofi@example.test", "viewer", "Ghana", "en", now, now]);
  for (const [name, slug, description] of seededCategories) {
    await db.unsafe("INSERT OR IGNORE INTO categories (name,slug,description) VALUES (?,?,?)", [name, slug, description]);
  }
  const existing = await db`SELECT COUNT(*) AS count FROM films`;
  if (Number(existing[0]?.count ?? 0) === 0) {
    for (let i = 0;i < seededFilms.length; i++) {
      const film = seededFilms[i];
      const createdAt = new Date(Date.now() - i * 86400000).toISOString();
      const inserted = await db.unsafe(`INSERT INTO films (title,description,poster_url,duration,genre,region,language,rating,review_count,view_count,
          monetization,price,is_festival_winner,is_featured,creator_id,cast,director,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,'published',?,?) RETURNING id`, [
        film.title,
        film.description,
        film.posterUrl,
        film.duration,
        film.genre,
        film.region,
        film.language,
        film.rating,
        film.reviewCount,
        film.viewCount,
        film.monetization,
        film.price,
        Number(film.festival),
        Number(film.featured),
        film.cast,
        film.director,
        createdAt,
        createdAt
      ]);
      const filmId = Number(inserted[0]?.id);
      const [category] = await db.unsafe("SELECT id FROM categories WHERE name = ?", [film.category]);
      await db.unsafe("INSERT OR IGNORE INTO film_categories (film_id,category_id) VALUES (?,?)", [filmId, category?.id]);
      for (const tag of film.tags)
        await db.unsafe("INSERT OR IGNORE INTO film_tags (film_id,tag) VALUES (?,?)", [filmId, tag]);
      for (const language of film.subtitles) {
        await db.unsafe("INSERT OR IGNORE INTO film_subtitles (film_id,language) VALUES (?,?)", [filmId, language]);
      }
    }
    const reviews = [
      [1, 2, 5, "A beautiful story rooted in place and family."],
      [1, 1, 5, "Moving performances and stunning scenery."],
      [2, 2, 5, "A thoughtful and lovely film."],
      [4, 2, 5, "A remarkable documentary."]
    ];
    for (const [filmId, userId, rating, comment] of reviews) {
      await db.unsafe("INSERT INTO reviews (film_id,user_id,rating,comment,created_at) VALUES (?,?,?,?,?)", [filmId, userId, rating, comment, now]);
    }
  }
  for (const plan of seededPlans) {
    await db.unsafe("INSERT OR IGNORE INTO plans (name,price_monthly,price_annual,is_popular) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = ?)", [plan.name, plan.monthly, plan.annual, plan.popular, plan.name]);
    const [row] = await db.unsafe("SELECT id FROM plans WHERE name = ?", [plan.name]);
    for (const feature of plan.features) {
      await db.unsafe("INSERT OR IGNORE INTO plan_features (plan_id,feature) VALUES (?,?)", [row?.id, feature]);
    }
  }
}
export function createDatabase(filename = process.env.DATABASE_PATH ?? "./reel.sqlite") {
  return new SQL({ adapter: "sqlite", filename });
}
