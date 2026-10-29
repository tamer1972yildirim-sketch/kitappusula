/**
 * KitapPusula — %100 Ücretsiz & Açık Kaynak Kitap Özeti ve Bilgi Bulucu
 *
 * Mimari Özellikler:
 * 1. API Anahtarı İstemeyen Açık Kaynak Çoklu Veri Motoru:
 *    - Türkçe Wikipedia API (`tr.wikipedia.org/w/api.php`) — Tam metin kitap özetleri ve gerçek yazar biyografileri
 *    - İngilizce Wikipedia API (`en.wikipedia.org/w/api.php`) — Uluslararası eser detayları ve yüksek çözünürlüklü kapaklar
 *    - Open Library Search & Works API (`openlibrary.org`) — Türkçe/uluslararası edisyonlar, ISBN kapakları ve eser açıklamaları
 *    - Google Books API (`maxResults=10`, arama başına yalnızca 1 istek; 429 durumunda sessizce Wikipedia ve Open Library kullanılır)
 *
 * 2. 429 Koruması ve Yerel Önbellek (localStorage Cache):
 *    - Sayfa açıldığında otomatik arama yapılmaz; yalnızca kullanıcı "Kitap Ara" butonuna veya Enter'a bastığında arama yapılır.
 *    - Aranan kitaplar `localStorage` önbelleğine kaydedilir; aynı kitap tekrar arandığında kota harcamadan anında getirilir.
 *
 * 3. Kullanıcı Katkısı ("✏️ Bilgileri Düzenle / Kütüphaneme Kaydet"):
 *    - Kullanıcı herhangi bir kitabın özetini, yazar bilgisini veya künyesini düzenleyip tek tıkla yerel veritabanına (`localStorage`)
 *      kalıcı olarak kaydedebilir veya çok yeni bir kitabı sıfırdan kendi özetiyle ekleyebilir.
 */

// ============================================================================
// 1. AÇIK KAYNAK API UÇ NOKTALARI & YAPILANDIRMA
// ============================================================================
const TR_WIKIPEDIA_API_URL = "https://tr.wikipedia.org/w/api.php";
const EN_WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php";
const OPEN_LIBRARY_API_URL = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_BASE_URL = "https://openlibrary.org";
const GOOGLE_BOOKS_API_URL = "https://www.googleapis.com/books/v1/volumes";

const STORAGE_KEYS = {
    SAVED_BOOKS: "kitappusula_optional_saved_books_v3",
    SEARCH_CACHE: "kitappusula_open_search_cache_v1",
    THEME: "kitappusula_theme"
};

const COVER_PALETTES = [
    ["#7c2d12", "#b45309"],
    ["#1e293b", "#991b1b"],
    ["#1e3a8a", "#0f766e"],
    ["#31102f", "#7f1d1d"],
    ["#1d4ed8", "#d97706"],
    ["#3f2e21", "#713f12"],
    ["#0f766e", "#b45309"],
    ["#18181b", "#52525b"]
];

let activeSearchController = null;
let currentActiveQuery = "";
let currentDisplayedBooks = [];
const authorBioSessionCache = new Map();

// ============================================================================
// 2. DOM ELEMANLARI
// ============================================================================
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const clearInputBtn = document.getElementById("clearInputBtn");
const resultsHeader = document.getElementById("resultsHeader");
const resultsTitle = document.getElementById("resultsTitle");
const resultsCount = document.getElementById("resultsCount");
const resultsContainer = document.getElementById("resultsContainer");
const showAllBtn = document.getElementById("showAllBtn");
const addCustomBookBtn = document.getElementById("addCustomBookBtn");
const brandReset = document.getElementById("brandReset");
const themeToggle = document.getElementById("themeToggle");

// Kullanıcı Katkısı (Düzenle / Kaydet) Modal DOM Elemanları
const editBookModal = document.getElementById("editBookModal");
const closeEditModalBtn = document.getElementById("closeEditModalBtn");
const cancelEditBookBtn = document.getElementById("cancelEditBookBtn");
const editBookForm = document.getElementById("editBookForm");
const editBookIdInput = document.getElementById("editBookId");
const editBookTitleInput = document.getElementById("editBookTitle");
const editBookAuthorInput = document.getElementById("editBookAuthor");
const editBookYearInput = document.getElementById("editBookYear");
const editBookGenreInput = document.getElementById("editBookGenre");
const editBookPagesInput = document.getElementById("editBookPages");
const editBookCoverUrlInput = document.getElementById("editBookCoverUrl");
const editBookAuthorBioInput = document.getElementById("editBookAuthorBio");
const editBookSummaryInput = document.getElementById("editBookSummary");

// ============================================================================
// 3. METİN NORMALİZASYONU VE ESNEK / DOLU İÇERİK PUANLAMASI
// ============================================================================

function cleanUnicodeText(text) {
    if (!text) return "";
    return text.toString().normalize("NFC").replace(/[ \t]+/g, " ").trim();
}

function normalizeText(text) {
    if (!text) return "";
    return cleanUnicodeText(text)
        .replace(/İ/g, "i")
        .replace(/I/g, "ı")
        .toLocaleLowerCase("tr-TR")
        .replace(/â/g, "a")
        .replace(/î/g, "i")
        .replace(/û/g, "u")
        .replace(/\s+/g, " ")
        .trim();
}

function toAsciiFold(text) {
    if (!text) return "";
    return text
        .toString()
        .replace(/İ/g, "i")
        .replace(/I/g, "i")
        .replace(/ı/g, "i")
        .toLocaleLowerCase("tr-TR")
        .replace(/ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/ı/g, "i")
        .replace(/ö/g, "o")
        .replace(/ç/g, "c")
        .replace(/â/g, "a")
        .replace(/î/g, "i")
        .replace(/û/g, "u")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getCanonicalTitleKey(rawTitle) {
    if (!rawTitle) return "";
    const stripped = rawTitle
        .toString()
        .replace(/\s*\((?:roman|kitap|kitap serisi|serisi|öykü|oyku|novella|eser|tiyatro|novel|book).*?\)/gi, "")
        .split(":")[0]
        .trim();
    return toAsciiFold(stripped || rawTitle);
}

function stripHtmlPreserveParagraphs(rawText) {
    if (!rawText) return "";
    const withLineBreaks = rawText
        .toString()
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/\s*p\s*>/gi, "\n\n")
        .replace(/<\/\s*div\s*>/gi, "\n\n")
        .replace(/<\s*li\s*>/gi, "\n• ");

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = withLineBreaks;
    const rawClean = tempDiv.textContent || tempDiv.innerText || "";

    return rawClean
        .normalize("NFC")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n\s*\n+/g, "\n\n")
        .trim();
}

/**
 * Wikipedia tam metin (extracts) çıktısındaki "Kaynakça", "Dış bağlantılar", "Ayrıca bakınız"
 * gibi alt başlıkları temizleyip yalnızca kitabın tanıtım ve konu/özet paragraflarını korur.
 */
function cleanWikipediaFullExtract(rawExtract) {
    if (!rawExtract) return "";
    let text = rawExtract
        .toString()
        .normalize("NFC")
        .replace(/\r\n/g, "\n");

    // Gereksiz alt bölümleri kes
    const stopHeadings = [
        /\n==\s*Ayrıca bakınız\s*==/i,
        /\n==\s*Kaynakça\s*==/i,
        /\n==\s*Notlar\s*==/i,
        /\n==\s*Dış bağlantılar\s*==/i,
        /\n==\s*See also\s*==/i,
        /\n==\s*References\s*==/i,
        /\n==\s*External links\s*==/i,
        /\n==\s*Further reading\s*==/i
    ];

    for (const regex of stopHeadings) {
        const match = text.search(regex);
        if (match !== -1) {
            text = text.slice(0, match);
        }
    }

    // == Konusu == gibi alt başlık işaretlerini şık satır başlarına dönüştür
    text = text
        .replace(/\n===+\s*([^=\n]+?)\s*===+\n/g, "\n\n$1:\n")
        .replace(/\n==\s*([^=\n]+?)\s*==\n/g, "\n\n$1:\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n\s*\n+/g, "\n\n")
        .trim();

    return text;
}

function formatDetailedSummary(rawSummary, fallbackContext) {
    const clean = stripHtmlPreserveParagraphs(rawSummary);
    if (!clean || clean.length < 25) {
        return fallbackContext;
    }
    return clean;
}

function formatAuthorBioSentences(rawBio, fallbackBio) {
    const clean = stripHtmlPreserveParagraphs(rawBio).replace(/\n+/g, " ").trim();
    if (!clean || clean.length < 20) {
        return fallbackBio;
    }

    const sentences = clean.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 0) {
        return sentences.slice(0, 5).join(" ").replace(/\s+/g, " ").trim();
    }

    return clean.length > 520 ? clean.slice(0, 520).replace(/\s+\S*$/, "") + "..." : clean;
}

function pickPaletteForTitle(title) {
    let hash = 0;
    const str = title || "Kitap";
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return COVER_PALETTES[Math.abs(hash) % COVER_PALETTES.length];
}

function buildDefaultAuthorBio(authorName, genre, year) {
    if (!authorName || authorName === "Yazar Bilgisi Belirtilmemiş") {
        return "Bu eserin yazarı hakkında katalog kayıtlarında detaylı biyografik bilgi belirtilmemiştir.";
    }
    const cleanGenre = (genre || "edebiyat ve araştırma").toLocaleLowerCase("tr-TR");
    const yearNote =
        year && year !== "Belirtilmemiş"
            ? ` Özellikle ${year} yılı ve sonrasındaki yayınlarıyla tanınmaktadır.`
            : " Eserleri ulusal ve uluslararası kütüphane kataloglarında yer almaktadır.";
    return `${authorName}, ${cleanGenre} alanında kaleme aldığı nitelikli eserlerle tanınan yazar ve düşünürdür.${yearNote} Anlatım gücü ve ele aldığı temalarla okurların ilgisini çeken önemli çalışmalara imza atmıştır.`;
}

function scoreBookMatchAndCompleteness(book, rawQuery) {
    const foldQuery = toAsciiFold(rawQuery);
    const normQuery = normalizeText(rawQuery);
    if (!foldQuery) return 0;

    const foldTitle = toAsciiFold(book.title);
    const canonicalTitle = getCanonicalTitleKey(book.title);
    const foldFullTitle = toAsciiFold(`${book.title} ${book.fullTitle || ""} ${book.originalTitle || ""}`);
    const foldAuthor = toAsciiFold(book.author);
    const foldSummary = toAsciiFold(book.summary);
    const normFullTitle = normalizeText(`${book.title} ${book.fullTitle || ""} ${book.originalTitle || ""}`);

    let relevanceScore = 0;

    // 1. Başlık eşleşme puanı
    if (foldTitle === foldQuery || canonicalTitle === foldQuery || normFullTitle === normQuery) {
        relevanceScore += 160;
    } else if (foldTitle.startsWith(foldQuery) || canonicalTitle.startsWith(foldQuery)) {
        relevanceScore += 120;
    } else if (foldFullTitle.includes(foldQuery) || normFullTitle.includes(normQuery)) {
        relevanceScore += 95;
    }

    // 2. Yazar eşleşme puanı
    if (foldAuthor.includes(foldQuery)) {
        relevanceScore += 65;
    }

    // 3. Kısmi kelime (token) eşleşme puanı
    const tokens = foldQuery.split(" ").filter((t) => t.length >= 2);
    let matchedTokenCount = 0;

    tokens.forEach((token) => {
        if (foldFullTitle.includes(token)) {
            matchedTokenCount++;
            relevanceScore += 42;
        } else if (foldAuthor.includes(token)) {
            matchedTokenCount++;
            relevanceScore += 30;
        } else if (foldSummary.includes(token)) {
            matchedTokenCount++;
            relevanceScore += 12;
        }
    });

    if (tokens.length > 0 && matchedTokenCount === 0 && relevanceScore === 0 && !book.isEditionMatched) {
        return 0;
    }

    if (tokens.length > 1 && matchedTokenCount === tokens.length) {
        relevanceScore += 55;
    }

    // 4. İçerik Doluluğu (Completeness) Bonusu: Özeti ve Kapağı Olanları Önceliklendir
    let completenessScore = 0;
    const summaryLen = (book.summary || "").length;

    if (book.coverUrl) {
        completenessScore += 45;
    }
    if (book.hasRichDescription) {
        completenessScore += 65;
        completenessScore += Math.min(45, Math.floor(summaryLen / 40));
    }
    if (book.coverUrl && book.hasRichDescription) {
        completenessScore += 50;
    }
    if (book.hasRichAuthorBio) {
        completenessScore += 25;
    }
    if (book.isTurkishContent) {
        completenessScore += 35;
    }
    if (book.isCustomEdited) {
        completenessScore += 120;
    }
    if (book.popularityScore) {
        completenessScore += Math.min(35, Math.round(Math.log10(book.popularityScore + 1) * 10));
    }

    return relevanceScore + completenessScore;
}

// ============================================================================
// 4. YEREL KÜTÜPHANE (KAYIT & DÜZENLEME) VE ARAMA ÖNBELLEĞİ (localStorage)
// ============================================================================

const LocalBookLibrary = {
    getAllMap() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.SAVED_BOOKS);
            return raw ? JSON.parse(raw) : {};
        } catch (_) {
            return {};
        }
    },

    getAllList() {
        const map = this.getAllMap();
        return Object.values(map).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    },

    isSaved(bookId) {
        const map = this.getAllMap();
        return Boolean(map[bookId]);
    },

    saveOrUpdateBook(book) {
        if (!book || !book.id) return;
        const map = this.getAllMap();
        map[book.id] = {
            ...book,
            savedAt: Date.now()
        };
        try {
            localStorage.setItem(STORAGE_KEYS.SAVED_BOOKS, JSON.stringify(map));
        } catch (err) {
            console.warn("Yerel kütüphane kaydı uyarısı:", err);
        }
        updateSavedCounterUI();
    },

    toggleSaveBook(book) {
        if (!book || !book.id) return false;
        const map = this.getAllMap();
        let isNowSaved = false;

        if (map[book.id]) {
            delete map[book.id];
            isNowSaved = false;
        } else {
            map[book.id] = {
                ...book,
                savedAt: Date.now()
            };
            isNowSaved = true;
        }

        try {
            localStorage.setItem(STORAGE_KEYS.SAVED_BOOKS, JSON.stringify(map));
        } catch (err) {
            console.warn("Kitaplık kaydı sırasında uyarı:", err);
        }

        updateSavedCounterUI();
        return isNowSaved;
    },

    searchSavedBooks(rawQuery) {
        const list = this.getAllList();
        return list.filter((book) => scoreBookMatchAndCompleteness(book, rawQuery) > 0);
    }
};

function updateSavedCounterUI() {
    const count = LocalBookLibrary.getAllList().length;
    const labelSpan = showAllBtn.querySelector("span");
    if (labelSpan) {
        labelSpan.textContent = count > 0 ? `Kitaplığım (${count})` : "Kitaplığım";
    }
}

const SearchResultCache = {
    makeKey(rawQuery) {
        return normalizeText(rawQuery);
    },

    getAllMap() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.SEARCH_CACHE);
            return raw ? JSON.parse(raw) : {};
        } catch (_) {
            return {};
        }
    },

    get(rawQuery) {
        const key = this.makeKey(rawQuery);
        if (!key) return null;
        const map = this.getAllMap();
        const entry = map[key];
        if (!entry || !Array.isArray(entry.books) || entry.books.length === 0) {
            return null;
        }
        return entry.books;
    },

    set(rawQuery, books) {
        const key = this.makeKey(rawQuery);
        if (!key || !Array.isArray(books) || books.length === 0) return;

        try {
            const map = this.getAllMap();
            map[key] = {
                query: rawQuery.trim(),
                cachedAt: Date.now(),
                books: books.slice(0, 10)
            };

            const keys = Object.keys(map);
            if (keys.length > 35) {
                keys.sort((a, b) => (map[a].cachedAt || 0) - (map[b].cachedAt || 0));
                const toRemove = keys.slice(0, keys.length - 35);
                toRemove.forEach((k) => delete map[k]);
            }

            localStorage.setItem(STORAGE_KEYS.SEARCH_CACHE, JSON.stringify(map));
        } catch (_) {
            // localStorage doluysa sessizce geç
        }
    }
};

// ============================================================================
// 5. AÇIK KAYNAK VERİ SERVİSLERİ (TR Wikipedia + EN Wikipedia + Open Library + Google Books)
// ============================================================================

/**
 * Kaynak 1: Türkçe Wikipedia API (`tr.wikipedia.org/w/api.php`)
 * Kitabın detaylı Türkçe özetini (`explaintext=1&exchars=2800` tam metin kesiti olarak) ve
 * varsa kapak görselini doğrudan çeker. Anahtar istemez ve kota sınırı yoktur.
 */
async function fetchBooksFromTurkishWikipediaAPI(query, signal) {
    const cleanQ = query.trim();
    const searchUrl = `${TR_WIKIPEDIA_API_URL}?action=query&list=search&srsearch=${encodeURIComponent(
        `${cleanQ} roman OR kitap OR eser`
    )}&srlimit=6&utf8=1&format=json&origin=*`;

    try {
        const searchRes = await fetch(searchUrl, { signal });
        if (!searchRes.ok) return [];

        const searchData = await searchRes.json();
        const hits = searchData?.query?.search || [];
        if (hits.length === 0) return [];

        const foldQuery = toAsciiFold(cleanQ);
        const queryTokens = foldQuery.split(" ").filter((t) => t.length >= 2);

        const relevantTitles = hits
            .filter((hit) => {
                const foldHitTitle = toAsciiFold(hit.title);
                const foldSnippet = toAsciiFold(stripHtmlPreserveParagraphs(hit.snippet || ""));
                const isBookArticle =
                    foldHitTitle.includes("roman") ||
                    foldHitTitle.includes("kitap") ||
                    foldSnippet.includes("roman") ||
                    foldSnippet.includes("kitap") ||
                    foldSnippet.includes("eser") ||
                    foldSnippet.includes("yazar") ||
                    foldSnippet.includes("öykü") ||
                    foldSnippet.includes("oyku");
                const matchesQuery =
                    foldHitTitle.includes(foldQuery) ||
                    queryTokens.some((token) => foldHitTitle.includes(token));
                return isBookArticle && matchesQuery;
            })
            .map((hit) => hit.title)
            .slice(0, 5);

        if (relevantTitles.length === 0) return [];

        // exintro olmadan (tam metin ilk 2800 karakter) çek ki "Konusu / Özeti" bölümleri de gelsin
        const detailsUrl = `${TR_WIKIPEDIA_API_URL}?action=query&prop=extracts|pageimages&explaintext=1&exchars=2800&piprop=thumbnail&pithumbsize=600&redirects=1&titles=${encodeURIComponent(
            relevantTitles.join("|")
        )}&format=json&origin=*`;

        const detailsRes = await fetch(detailsUrl, { signal });
        if (!detailsRes.ok) return [];

        const detailsData = await detailsRes.json();
        const pages = Object.values(detailsData?.query?.pages || {});

        const wikiBooks = [];
        for (const page of pages) {
            if (!page || page.missing || !page.extract) continue;

            const extract = cleanWikipediaFullExtract(page.extract);
            if (extract.length < 60) continue;

            const rawPageTitle = cleanUnicodeText(page.title || "");
            const cleanBookTitle = rawPageTitle
                .replace(/\s*\((?:roman|kitap|kitap serisi|serisi|öykü|oyku|eser|tiyatro)\)\s*$/i, "")
                .trim();

            let extractedAuthor = "Yazar Bilgisi Belirtilmemiş";
            const authorPatterns = [
                /(?:yazar|şair|romancı)\s+([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü.]+){1,3})\s+tarafından/i,
                /([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü.]+){1,3})\s+tarafından\s+(?:yazılan|kaleme alınan)/i,
                /([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü.]+){1,3})['’](?:nin|nın|nun|nün|in|ın|un|ün)\s+(?:\d{4}\s+yılında\s+)?(?:yayımladığı|yayınladığı|yazdığı|kaleme aldığı)/i
            ];

            for (const pattern of authorPatterns) {
                const match = extract.match(pattern);
                if (match && match[1]) {
                    extractedAuthor = cleanUnicodeText(match[1]);
                    break;
                }
            }

            const yearMatch = extract.match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
            const extractedYear = yearMatch ? yearMatch[1] : "Belirtilmemiş";
            const coverUrl = page.thumbnail?.source || "";

            wikiBooks.push({
                id: `trwiki_${page.pageid}`,
                workKey: "",
                isbns: [],
                title: cleanBookTitle,
                fullTitle: cleanBookTitle,
                originalTitle: cleanBookTitle,
                author: extractedAuthor,
                authorBio: buildDefaultAuthorBio(extractedAuthor, "Edebiyat & Roman", extractedYear),
                hasRichAuthorBio: false,
                year: extractedYear,
                pages: null,
                genre: "Edebiyat & Roman",
                coverUrl,
                summary: extract,
                hasRichDescription: extract.length >= 120,
                isTurkishContent: true,
                isEditionMatched: true,
                isCustomEdited: false,
                sourceLabel: "🌐 Wikipedia + Açık Kütüphane",
                popularityScore: 135,
                infoLink: `https://tr.wikipedia.org/wiki/${encodeURIComponent(rawPageTitle.replace(/ /g, "_"))}`,
                palette: pickPaletteForTitle(cleanBookTitle)
            });
        }

        return wikiBooks;
    } catch (err) {
        if (err.name === "AbortError") throw err;
        return [];
    }
}

/**
 * Kaynak 2: İngilizce Wikipedia API (`en.wikipedia.org/w/api.php`)
 * Özellikle dünya edebiyatı eserlerinde yüksek çözünürlüklü kapak görseli ve ek eser bilgisi sağlar.
 */
async function fetchBooksFromEnglishWikipediaAPI(query, signal) {
    const cleanQ = query.trim();
    const searchUrl = `${EN_WIKIPEDIA_API_URL}?action=query&list=search&srsearch=${encodeURIComponent(
        `${cleanQ} novel OR book`
    )}&srlimit=4&utf8=1&format=json&origin=*`;

    try {
        const searchRes = await fetch(searchUrl, { signal });
        if (!searchRes.ok) return [];

        const searchData = await searchRes.json();
        const hits = searchData?.query?.search || [];
        if (hits.length === 0) return [];

        const foldQuery = toAsciiFold(cleanQ);
        const queryTokens = foldQuery.split(" ").filter((t) => t.length >= 2);

        const relevantTitles = hits
            .filter((hit) => {
                const foldHitTitle = toAsciiFold(hit.title);
                const foldSnippet = toAsciiFold(stripHtmlPreserveParagraphs(hit.snippet || ""));
                const isBook =
                    foldHitTitle.includes("novel") ||
                    foldHitTitle.includes("book") ||
                    foldSnippet.includes("novel") ||
                    foldSnippet.includes("book") ||
                    foldSnippet.includes("written by") ||
                    foldSnippet.includes("author");
                const matchesQuery =
                    foldHitTitle.includes(foldQuery) ||
                    queryTokens.some((token) => foldHitTitle.includes(token));
                return isBook && matchesQuery;
            })
            .map((hit) => hit.title)
            .slice(0, 3);

        if (relevantTitles.length === 0) return [];

        const detailsUrl = `${EN_WIKIPEDIA_API_URL}?action=query&prop=extracts|pageimages&explaintext=1&exchars=1800&piprop=thumbnail&pithumbsize=600&redirects=1&titles=${encodeURIComponent(
            relevantTitles.join("|")
        )}&format=json&origin=*`;

        const detailsRes = await fetch(detailsUrl, { signal });
        if (!detailsRes.ok) return [];

        const detailsData = await detailsRes.json();
        const pages = Object.values(detailsData?.query?.pages || {});

        const enWikiBooks = [];
        for (const page of pages) {
            if (!page || page.missing || !page.extract) continue;

            const extract = cleanWikipediaFullExtract(page.extract);
            if (extract.length < 80) continue;

            const rawPageTitle = cleanUnicodeText(page.title || "");
            const cleanBookTitle = rawPageTitle
                .replace(/\s*\((?:novel|book|novella|short story collection|series).*?\)\s*$/i, "")
                .trim();

            let extractedAuthor = "Yazar Bilgisi Belirtilmemiş";
            const byMatch = extract.match(
                /\b(?:written\s+by|by\s+(?:American|British|Russian|French|German|Turkish|author|novelist|writer)?\s*)([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,2})/
            );
            if (byMatch && byMatch[1]) {
                extractedAuthor = cleanUnicodeText(byMatch[1]);
            }

            const yearMatch = extract.match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
            const extractedYear = yearMatch ? yearMatch[1] : "Belirtilmemiş";
            const coverUrl = page.thumbnail?.source || "";

            enWikiBooks.push({
                id: `enwiki_${page.pageid}`,
                workKey: "",
                isbns: [],
                title: cleanBookTitle,
                fullTitle: cleanBookTitle,
                originalTitle: cleanBookTitle,
                author: extractedAuthor,
                authorBio: buildDefaultAuthorBio(extractedAuthor, "Edebiyat & Roman", extractedYear),
                hasRichAuthorBio: false,
                year: extractedYear,
                pages: null,
                genre: "Edebiyat & Roman",
                coverUrl,
                summary: extract,
                hasRichDescription: extract.length >= 140,
                isTurkishContent: false,
                isEditionMatched: false,
                isCustomEdited: false,
                sourceLabel: "🌐 Wikipedia + Açık Kütüphane",
                popularityScore: 95,
                infoLink: `https://en.wikipedia.org/wiki/${encodeURIComponent(rawPageTitle.replace(/ /g, "_"))}`,
                palette: pickPaletteForTitle(cleanBookTitle)
            });
        }

        return enWikiBooks;
    } catch (err) {
        if (err.name === "AbortError") throw err;
        return [];
    }
}

/**
 * Kaynak 3: Open Library API (`openlibrary.org/search.json`)
 * Anahtar istemez, kota sınırı yoktur. Türkçe edisyonları, ISBN kapaklarını ve eser anahtarlarını (`workKey`) çeker.
 */
async function fetchBooksFromOpenLibraryAPI(query, signal) {
    const fields = [
        "key",
        "title",
        "author_name",
        "first_publish_year",
        "number_of_pages_median",
        "edition_count",
        "ratings_count",
        "cover_i",
        "isbn",
        "subject",
        "first_sentence",
        "editions",
        "editions.title",
        "editions.cover_i",
        "editions.isbn"
    ].join(",");

    const url = `${OPEN_LIBRARY_API_URL}?q=${encodeURIComponent(query.trim())}&fields=${fields}&limit=15`;

    try {
        const response = await fetch(url, { signal });
        if (!response.ok) return [];

        const data = await response.json();
        if (!data || !Array.isArray(data.docs)) return [];

        const parsedBooks = [];
        for (const doc of data.docs) {
            if (!doc.title) continue;

            const originalTitle = cleanUnicodeText(doc.title);
            const editionDoc =
                doc.editions && Array.isArray(doc.editions.docs) && doc.editions.docs.length > 0
                    ? doc.editions.docs[0]
                    : null;

            const editionTitle =
                editionDoc && editionDoc.title ? cleanUnicodeText(editionDoc.title) : "";

            const displayTitle = editionTitle || originalTitle;
            const fullTitle =
                editionTitle && toAsciiFold(editionTitle) !== toAsciiFold(originalTitle)
                    ? `${editionTitle} (${originalTitle})`
                    : displayTitle;

            const author = Array.isArray(doc.author_name)
                ? cleanUnicodeText(doc.author_name.join(", "))
                : "Yazar Bilgisi Belirtilmemiş";

            const isbns = [
                ...(Array.isArray(editionDoc?.isbn) ? editionDoc.isbn : []),
                ...(Array.isArray(doc.isbn) ? doc.isbn.slice(0, 3) : [])
            ];

            const coverId = (editionDoc && editionDoc.cover_i) || doc.cover_i;
            let coverUrl = "";
            if (coverId) {
                coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
            } else if (isbns.length > 0) {
                coverUrl = `https://covers.openlibrary.org/b/isbn/${isbns[0]}-L.jpg`;
            }

            const year = doc.first_publish_year || "Belirtilmemiş";
            const pages = doc.number_of_pages_median || null;
            const genre =
                Array.isArray(doc.subject) && doc.subject.length > 0
                    ? cleanUnicodeText(doc.subject[0])
                    : "Edebiyat & Roman";

            const firstSentence = Array.isArray(doc.first_sentence)
                ? doc.first_sentence.join(" ")
                : doc.first_sentence || "";

            const origNote =
                editionTitle && toAsciiFold(editionTitle) !== toAsciiFold(originalTitle)
                    ? ` (Orijinal adı: "${originalTitle}")`
                    : "";
            const pageNote = pages ? ` Yaklaşık ${pages} sayfadan oluşan bu kapsamlı eser,` : " Bu eser,";

            const fallbackSummary = `${author} tarafından kaleme alınan "${displayTitle}"${origNote}, ilk kez ${year} yılında okurlarla buluşmuştur.${pageNote} ${genre.toLowerCase()} alanında derinlikli kurgusu, karakter analizleri ve ele aldığı evrensel temalarla edebiyat dünyasında önemli bir yere sahiptir.`;

            const cleanedFirstSentence = stripHtmlPreserveParagraphs(firstSentence);
            const hasRichDescription = cleanedFirstSentence.length >= 120;
            const popularityScore = (doc.edition_count || 1) * 3 + (doc.ratings_count || 0) * 5;

            const book = {
                id: `openlib_${(doc.key || displayTitle).replace(/\W+/g, "_")}`,
                workKey: doc.key || "",
                isbns,
                title: displayTitle,
                fullTitle,
                originalTitle,
                author,
                authorBio: buildDefaultAuthorBio(author, genre, year),
                hasRichAuthorBio: false,
                year,
                pages,
                genre,
                coverUrl,
                summary: formatDetailedSummary(
                    cleanedFirstSentence ? `${cleanedFirstSentence}\n\n${fallbackSummary}` : "",
                    fallbackSummary
                ),
                hasRichDescription,
                isTurkishContent: Boolean(editionTitle),
                isEditionMatched: Boolean(editionTitle),
                isCustomEdited: false,
                sourceLabel: "📚 Open Library + Wikipedia",
                popularityScore,
                infoLink: doc.key ? `${OPEN_LIBRARY_BASE_URL}${doc.key}` : "",
                palette: pickPaletteForTitle(displayTitle)
            };

            if (scoreBookMatchAndCompleteness(book, query) > 0) {
                parsedBooks.push(book);
            }
        }

        return parsedBooks;
    } catch (err) {
        if (err.name === "AbortError") throw err;
        return [];
    }
}

/**
 * Kaynak 4: Google Books API (`maxResults=10`, Arama Başına Yalnızca 1 İstek).
 * Eğer Google Books 429 dönerse kullanıcıya hata göstermez, sessizce `[]` döner ve
 * uygulama Open Library + Wikipedia verileriyle kesintisiz devam eder.
 */
function parseGoogleBookVolume(item) {
    const info = item.volumeInfo || {};
    const searchSnippet = item.searchInfo ? item.searchInfo.textSnippet : "";

    const rawTitle = cleanUnicodeText(info.title || "");
    if (!rawTitle) return null;

    const subtitle = cleanUnicodeText(info.subtitle || "");
    const fullTitle = subtitle ? `${rawTitle}: ${subtitle}` : rawTitle;

    const author =
        Array.isArray(info.authors) && info.authors.length > 0
            ? cleanUnicodeText(info.authors.join(", "))
            : "Yazar Bilgisi Belirtilmemiş";

    const yearMatch = (info.publishedDate || "").match(/\d{4}/);
    const year = yearMatch ? yearMatch[0] : "Belirtilmemiş";
    const pages = info.pageCount && info.pageCount > 0 ? info.pageCount : null;

    const genre =
        Array.isArray(info.categories) && info.categories.length > 0
            ? cleanUnicodeText(info.categories[0])
            : "Edebiyat & Kitap";

    const isbns = Array.isArray(info.industryIdentifiers)
        ? info.industryIdentifiers
              .map((idObj) => (idObj.identifier || "").replace(/[^0-9Xx]/g, ""))
              .filter(Boolean)
        : [];

    let coverUrl = "";
    if (info.imageLinks) {
        const rawCover =
            info.imageLinks.extraLarge ||
            info.imageLinks.large ||
            info.imageLinks.medium ||
            info.imageLinks.thumbnail ||
            info.imageLinks.smallThumbnail ||
            "";
        coverUrl = rawCover
            .replace(/^http:\/\//i, "https://")
            .replace(/&edge=curl/gi, "");
    } else if (isbns.length > 0) {
        coverUrl = `https://covers.openlibrary.org/b/isbn/${isbns[0]}-L.jpg`;
    }

    const rawDescription = info.description || searchSnippet || "";
    const cleanedDesc = stripHtmlPreserveParagraphs(rawDescription);
    const hasRichDescription = cleanedDesc.length >= 120;
    const isTurkishContent =
        (info.language || "").toLowerCase() === "tr" || /[ğüşöçıİĞÜŞÖÇ]/.test(cleanedDesc + rawTitle);

    const publisherInfo = info.publisher
        ? `${cleanUnicodeText(info.publisher)} tarafından yayımlanan`
        : "Dünya kütüphane kataloglarında yer alan";
    const fallbackSummary = `${author} tarafından kaleme alınan "${fullTitle}", ${publisherInfo} önemli eserlerden biridir.${
        pages ? ` Toplam ${pages} sayfadan oluşan bu kitap,` : " Bu eser,"
    } yazarın anlatım derinliğini ve ele aldığı dönemin ruhunu yansıtan kurgusuyla dikkat çeker.`;

    const summary = formatDetailedSummary(rawDescription, fallbackSummary);
    const popularityScore = (info.ratingsCount || 0) * 10 + (hasRichDescription ? 30 : 0);

    return {
        id: `gbooks_${item.id}`,
        workKey: "",
        isbns,
        title: rawTitle,
        fullTitle,
        originalTitle: rawTitle,
        author,
        authorBio: buildDefaultAuthorBio(author, genre, year),
        hasRichAuthorBio: false,
        year,
        pages,
        genre,
        coverUrl,
        summary,
        hasRichDescription,
        isTurkishContent,
        isEditionMatched: false,
        isCustomEdited: false,
        sourceLabel: "📚 Açık Kütüphane Verisi",
        popularityScore,
        infoLink: info.infoLink || info.previewLink || "",
        palette: pickPaletteForTitle(rawTitle)
    };
}

async function fetchBooksFromGoogleAPI(query, signal) {
    const cleanQ = query.trim();
    const url = `${GOOGLE_BOOKS_API_URL}?q=${encodeURIComponent(cleanQ)}&maxResults=10`;

    try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
            // 429 veya herhangi bir hata durumunda sessizce boş dizi dön (Open Library + Wikipedia devrede)
            return [];
        }

        const data = await response.json();
        const rawItems = Array.isArray(data?.items) ? data.items : [];

        return rawItems
            .map((item) => parseGoogleBookVolume(item))
            .filter((book) => book && scoreBookMatchAndCompleteness(book, cleanQ) > 0);
    } catch (err) {
        if (err.name === "AbortError") throw err;
        return [];
    }
}

// ============================================================================
// 6. AKILLI VERİ BİRLEŞTİRME (WIKIPEDIA + OPEN LIBRARY + GOOGLE BOOKS)
// ============================================================================

function mergeTwoBookRecords(primary, secondary) {
    const primaryAuthorKnown =
        primary.author && primary.author !== "Yazar Bilgisi Belirtilmemiş";
    const secondaryAuthorKnown =
        secondary.author && secondary.author !== "Yazar Bilgisi Belirtilmemiş";

    let bestSummary = primary.summary || "";
    let hasRichDesc = primary.hasRichDescription;

    if (secondary.isCustomEdited) {
        bestSummary = secondary.summary;
        hasRichDesc = true;
    } else if (!primary.hasRichDescription && secondary.hasRichDescription) {
        bestSummary = secondary.summary;
        hasRichDesc = true;
    } else if (
        secondary.hasRichDescription &&
        primary.hasRichDescription &&
        secondary.isTurkishContent &&
        !primary.isTurkishContent
    ) {
        bestSummary = secondary.summary;
    } else if (
        secondary.hasRichDescription &&
        secondary.isTurkishContent === primary.isTurkishContent &&
        (secondary.summary || "").length > (primary.summary || "").length + 60
    ) {
        bestSummary = secondary.summary;
        hasRichDesc = true;
    }

    const mergedIsbns = Array.from(
        new Set([...(primary.isbns || []), ...(secondary.isbns || [])])
    );

    let bestCover = primary.coverUrl || secondary.coverUrl || "";
    if (!bestCover && mergedIsbns.length > 0) {
        bestCover = `https://covers.openlibrary.org/b/isbn/${mergedIsbns[0]}-L.jpg`;
    }

    return {
        ...primary,
        workKey: primary.workKey || secondary.workKey || "",
        isbns: mergedIsbns,
        title:
            primary.isTurkishContent || !secondary.isTurkishContent
                ? primary.title
                : secondary.title,
        fullTitle:
            (primary.fullTitle || "").length >= (secondary.fullTitle || "").length
                ? primary.fullTitle
                : secondary.fullTitle,
        originalTitle: primary.originalTitle || secondary.originalTitle,
        author: primaryAuthorKnown
            ? primary.author
            : secondaryAuthorKnown
            ? secondary.author
            : primary.author,
        authorBio: primary.hasRichAuthorBio ? primary.authorBio : secondary.authorBio,
        hasRichAuthorBio: primary.hasRichAuthorBio || secondary.hasRichAuthorBio,
        year:
            primary.year && primary.year !== "Belirtilmemiş"
                ? primary.year
                : secondary.year || "Belirtilmemiş",
        pages: primary.pages || secondary.pages || null,
        genre:
            primary.genre && primary.genre !== "Edebiyat & Kitap"
                ? primary.genre
                : secondary.genre || primary.genre,
        coverUrl: bestCover,
        summary: bestSummary,
        hasRichDescription: hasRichDesc,
        isTurkishContent: primary.isTurkishContent || secondary.isTurkishContent,
        isEditionMatched: primary.isEditionMatched || secondary.isEditionMatched,
        isCustomEdited: primary.isCustomEdited || secondary.isCustomEdited,
        sourceLabel:
            primary.isCustomEdited || secondary.isCustomEdited
                ? "✏️ Kütüphanem (Düzenlendi)"
                : "🌐 Wikipedia & Açık Kütüphane",
        popularityScore: Math.max(primary.popularityScore || 0, secondary.popularityScore || 0),
        infoLink: primary.infoLink || secondary.infoLink || ""
    };
}

function mergeAndRankMultiSourceBooks(allBooks, rawQuery) {
    const mergedList = [];

    for (const incoming of allBooks) {
        if (!incoming || !incoming.title) continue;

        const incTitleKey = getCanonicalTitleKey(incoming.title);
        const incOrigKey = getCanonicalTitleKey(incoming.originalTitle || "");
        const incAuthorFold = toAsciiFold(incoming.author);
        const incAuthorKnown =
            incoming.author && incoming.author !== "Yazar Bilgisi Belirtilmemiş";

        const existingIndex = mergedList.findIndex((existing) => {
            if (existing.id === incoming.id) return true;

            const exTitleKey = getCanonicalTitleKey(existing.title);
            const exOrigKey = getCanonicalTitleKey(existing.originalTitle || "");
            const exAuthorFold = toAsciiFold(existing.author);
            const exAuthorKnown =
                existing.author && existing.author !== "Yazar Bilgisi Belirtilmemiş";

            const titlesMatch =
                incTitleKey === exTitleKey ||
                (incOrigKey && incOrigKey === exTitleKey) ||
                (exOrigKey && incTitleKey === exOrigKey);

            if (!titlesMatch) return false;
            if (!incAuthorKnown || !exAuthorKnown) return true;

            const incLastWord = incAuthorFold.split(" ").pop();
            const exLastWord = exAuthorFold.split(" ").pop();
            return (
                incAuthorFold === exAuthorFold ||
                incAuthorFold.includes(exLastWord) ||
                exAuthorFold.includes(incLastWord)
            );
        });

        if (existingIndex === -1) {
            mergedList.push(incoming);
        } else {
            mergedList[existingIndex] = mergeTwoBookRecords(mergedList[existingIndex], incoming);
        }
    }

    return mergedList.sort(
        (a, b) =>
            scoreBookMatchAndCompleteness(b, rawQuery) -
            scoreBookMatchAndCompleteness(a, rawQuery)
    );
}

/**
 * Yazar Hakkında Biyografi Bilgisini Doğrudan Türkçe (ve yedek olarak İngilizce) Wikipedia'dan Çeker.
 */
async function enrichAuthorsFromWikipedia(books, signal) {
    if (!Array.isArray(books) || books.length === 0) return;

    const uniqueAuthors = [];
    for (const book of books) {
        if (book.hasRichAuthorBio) continue;
        const primaryAuthor = (book.author || "").split(",")[0].trim();
        if (
            primaryAuthor &&
            primaryAuthor !== "Yazar Bilgisi Belirtilmemiş" &&
            !authorBioSessionCache.has(primaryAuthor) &&
            !uniqueAuthors.includes(primaryAuthor)
        ) {
            uniqueAuthors.push(primaryAuthor);
        }
    }

    // 1. Aşama: Türkçe Wikipedia'da doğrudan başlıkla toplu sorgula
    if (uniqueAuthors.length > 0) {
        try {
            const titlesParam = uniqueAuthors.slice(0, 10).join("|");
            const url = `${TR_WIKIPEDIA_API_URL}?action=query&prop=extracts&exintro=1&explaintext=1&exsentences=5&redirects=1&titles=${encodeURIComponent(
                titlesParam
            )}&format=json&origin=*`;

            const response = await fetch(url, { signal });
            if (response.ok) {
                const data = await response.json();
                const pages = data?.query?.pages || {};
                const redirects = data?.query?.redirects || [];
                const normalized = data?.query?.normalized || [];

                const aliasToCanonical = new Map();
                normalized.forEach((n) => aliasToCanonical.set(toAsciiFold(n.from), toAsciiFold(n.to)));
                redirects.forEach((r) => aliasToCanonical.set(toAsciiFold(r.from), toAsciiFold(r.to)));

                const pageByFoldTitle = new Map();
                Object.values(pages).forEach((page) => {
                    if (page && page.title && page.extract && !page.missing) {
                        pageByFoldTitle.set(toAsciiFold(page.title), page.extract);
                    }
                });

                uniqueAuthors.forEach((authorName) => {
                    const foldAuthor = toAsciiFold(authorName);
                    const mappedTarget = aliasToCanonical.get(foldAuthor) || foldAuthor;
                    let extract = pageByFoldTitle.get(mappedTarget) || pageByFoldTitle.get(foldAuthor);

                    if (!extract) {
                        for (const [pageTitleFold, pageExtract] of pageByFoldTitle.entries()) {
                            if (pageTitleFold.includes(foldAuthor) || foldAuthor.includes(pageTitleFold)) {
                                extract = pageExtract;
                                break;
                            }
                        }
                    }

                    if (extract && extract.trim().length >= 30) {
                        authorBioSessionCache.set(authorName, formatAuthorBioSentences(extract, ""));
                    }
                });
            }
        } catch (err) {
            if (err.name === "AbortError") throw err;
        }
    }

    // 2. Aşama: Doğrudan bulunamayan yazarlar için Türkçe Wikipedia generator=search + İngilizce Wikipedia fallback
    const unresolvedAuthors = uniqueAuthors
        .filter((authorName) => !authorBioSessionCache.has(authorName))
        .slice(0, 4);

    if (unresolvedAuthors.length > 0) {
        await Promise.allSettled(
            unresolvedAuthors.map(async (authorName) => {
                try {
                    const trSearchUrl = `${TR_WIKIPEDIA_API_URL}?action=query&generator=search&gsrsearch=${encodeURIComponent(
                        authorName
                    )}&gsrlimit=2&prop=extracts&exintro=1&explaintext=1&exsentences=5&format=json&origin=*`;
                    const res = await fetch(trSearchUrl, { signal });
                    if (res.ok) {
                        const data = await res.json();
                        const pages = Object.values(data?.query?.pages || {});
                        const authorLastName = toAsciiFold(authorName).split(" ").pop();

                        const matchedPage = pages.find(
                            (p) =>
                                p &&
                                p.extract &&
                                authorLastName &&
                                toAsciiFold(p.title).includes(authorLastName)
                        );

                        if (matchedPage && matchedPage.extract.trim().length >= 30) {
                            authorBioSessionCache.set(
                                authorName,
                                formatAuthorBioSentences(matchedPage.extract, "")
                            );
                            return;
                        }
                    }

                    // Türkçe Wikipedia'da yoksa İngilizce Wikipedia'dan çek
                    const enUrl = `${EN_WIKIPEDIA_API_URL}?action=query&prop=extracts&exintro=1&explaintext=1&exsentences=4&redirects=1&titles=${encodeURIComponent(
                        authorName
                    )}&format=json&origin=*`;
                    const enRes = await fetch(enUrl, { signal });
                    if (enRes.ok) {
                        const enData = await enRes.json();
                        const firstPage = Object.values(enData?.query?.pages || {})[0];
                        if (firstPage && !firstPage.missing && firstPage.extract && firstPage.extract.trim().length >= 30) {
                            authorBioSessionCache.set(
                                authorName,
                                formatAuthorBioSentences(firstPage.extract, "")
                            );
                        }
                    }
                } catch (err) {
                    if (err.name === "AbortError") throw err;
                }
            })
        );
    }

    books.forEach((book) => {
        if (book.hasRichAuthorBio) return;
        const primaryAuthor = (book.author || "").split(",")[0].trim();
        if (authorBioSessionCache.has(primaryAuthor)) {
            book.authorBio = authorBioSessionCache.get(primaryAuthor);
            book.hasRichAuthorBio = true;
        }
    });
}

/**
 * Kitabın detaylı özeti veya kapak resmi eksikse Türkçe Wikipedia tam metin (extracts),
 * İngilizce Wikipedia ve Open Library Works API üzerinden otomatik tamamlar.
 */
async function completeMissingSummariesAndCovers(books, query, signal) {
    if (!Array.isArray(books) || books.length === 0) return;

    const candidatesToComplete = books
        .slice(0, 4)
        .filter((b) => (!b.hasRichDescription || !b.coverUrl) && !b.isCustomEdited);

    if (candidatesToComplete.length === 0) return;

    await Promise.allSettled(
        candidatesToComplete.map(async (book) => {
            // A) Türkçe Wikipedia API'den kitabın tam metin (extracts) özetini ve görselini çek
            if (!book.hasRichDescription || !book.coverUrl) {
                try {
                    const authorHint =
                        book.author && book.author !== "Yazar Bilgisi Belirtilmemiş"
                            ? book.author
                            : "";
                    const searchTerms = `${book.title} ${authorHint} roman kitap`.trim();
                    const searchUrl = `${TR_WIKIPEDIA_API_URL}?action=query&list=search&srsearch=${encodeURIComponent(
                        searchTerms
                    )}&srlimit=4&format=json&origin=*`;

                    const searchRes = await fetch(searchUrl, { signal });
                    if (searchRes.ok) {
                        const searchData = await searchRes.json();
                        const searchHits = searchData?.query?.search || [];
                        const foldBookTitle = getCanonicalTitleKey(book.title);
                        const foldOrigTitle = getCanonicalTitleKey(book.originalTitle || "");
                        const foldQuery = toAsciiFold(query);

                        const matchedHit = searchHits.find((hit) => {
                            const strippedHit = getCanonicalTitleKey(hit.title);
                            return (
                                strippedHit.length >= 3 &&
                                (strippedHit.includes(foldBookTitle) ||
                                    foldBookTitle.includes(strippedHit) ||
                                    (foldOrigTitle && strippedHit.includes(foldOrigTitle)) ||
                                    (foldQuery.length >= 4 && strippedHit.includes(foldQuery)))
                            );
                        });

                        if (matchedHit) {
                            const extractUrl = `${TR_WIKIPEDIA_API_URL}?action=query&prop=extracts|pageimages&explaintext=1&exchars=2800&piprop=thumbnail&pithumbsize=600&titles=${encodeURIComponent(
                                matchedHit.title
                            )}&format=json&origin=*`;
                            const extractRes = await fetch(extractUrl, { signal });
                            if (extractRes.ok) {
                                const extractData = await extractRes.json();
                                const firstPage = Object.values(extractData?.query?.pages || {})[0];
                                const fullExtract = cleanWikipediaFullExtract(firstPage?.extract || "");

                                if (fullExtract && fullExtract.length >= 80 && !book.hasRichDescription) {
                                    book.summary = fullExtract;
                                    book.hasRichDescription = true;
                                    book.isTurkishContent = true;
                                }
                                if (!book.coverUrl && firstPage?.thumbnail?.source) {
                                    book.coverUrl = firstPage.thumbnail.source;
                                }
                            }
                        }
                    }
                } catch (err) {
                    if (err.name === "AbortError") throw err;
                }
            }

            // B) Open Library Work JSON detayından özet ve kapak tamamlama
            if ((!book.hasRichDescription || !book.coverUrl) && book.workKey) {
                try {
                    const workUrl = `${OPEN_LIBRARY_BASE_URL}${book.workKey}.json`;
                    const workRes = await fetch(workUrl, { signal });
                    if (workRes.ok) {
                        const workData = await workRes.json();
                        const rawWorkDesc =
                            typeof workData.description === "string"
                                ? workData.description
                                : workData.description?.value || "";
                        const cleanedWorkDesc = stripHtmlPreserveParagraphs(rawWorkDesc);

                        if (!book.hasRichDescription && cleanedWorkDesc && cleanedWorkDesc.length >= 80) {
                            book.summary = `${cleanedWorkDesc}\n\n${book.summary}`;
                            book.hasRichDescription = true;
                        }
                        if (
                            !book.coverUrl &&
                            Array.isArray(workData.covers) &&
                            workData.covers.length > 0 &&
                            workData.covers[0] > 0
                        ) {
                            book.coverUrl = `https://covers.openlibrary.org/b/id/${workData.covers[0]}-L.jpg`;
                        }
                    }
                } catch (err) {
                    if (err.name === "AbortError") throw err;
                }
            }

            // C) Kapak hâlâ eksikse Open Library başlık sorgusuyla kapağı tamamla
            if (!book.coverUrl) {
                try {
                    const coverSearchUrl = `${OPEN_LIBRARY_API_URL}?title=${encodeURIComponent(
                        book.title
                    )}&fields=cover_i,isbn&limit=3`;
                    const coverRes = await fetch(coverSearchUrl, { signal });
                    if (coverRes.ok) {
                        const coverData = await coverRes.json();
                        const docWithCover = (coverData?.docs || []).find(
                            (d) => d.cover_i || (Array.isArray(d.isbn) && d.isbn.length > 0)
                        );
                        if (docWithCover) {
                            book.coverUrl = docWithCover.cover_i
                                ? `https://covers.openlibrary.org/b/id/${docWithCover.cover_i}-L.jpg`
                                : `https://covers.openlibrary.org/b/isbn/${docWithCover.isbn[0]}-L.jpg`;
                        }
                    }
                } catch (err) {
                    if (err.name === "AbortError") throw err;
                }
            }
        })
    );
}

// ============================================================================
// 7. ÇOKLU AÇIK KAYNAK ORKESTRASYONU
// ============================================================================

async function fetchOpenSourceBooks(query, signal, onLoadingStepUpdate) {
    // Kullanıcının yerel veritabanına (localStorage) kaydettiği/düzenlediği eşleşen kitapları kontrol et
    const localSavedMatches = LocalBookLibrary.searchSavedBooks(query);

    // Dört açık kaynağı aynı anda sorgula (TR Wikipedia + EN Wikipedia + Open Library + Google Books maxResults=10)
    const [trWikiOutcome, enWikiOutcome, openLibOutcome, googleOutcome] = await Promise.allSettled([
        fetchBooksFromTurkishWikipediaAPI(query, signal),
        fetchBooksFromEnglishWikipediaAPI(query, signal),
        fetchBooksFromOpenLibraryAPI(query, signal),
        fetchBooksFromGoogleAPI(query, signal)
    ]);

    const trWikiBooks = trWikiOutcome.status === "fulfilled" ? trWikiOutcome.value : [];
    const enWikiBooks = enWikiOutcome.status === "fulfilled" ? enWikiOutcome.value : [];
    const openLibBooks = openLibOutcome.status === "fulfilled" ? openLibOutcome.value : [];
    const googleBooks = googleOutcome.status === "fulfilled" ? googleOutcome.value : [];

    // Tüm kaynaklardan gelen kitapları birleştir
    let mergedBooks = mergeAndRankMultiSourceBooks(
        [...localSavedMatches, ...trWikiBooks, ...openLibBooks, ...googleBooks, ...enWikiBooks],
        query
    ).slice(0, 12);

    // Eksik özet ve kapakları Wikipedia / Open Library'den tamamla & Yazar biyografilerini Wikipedia'dan çek
    if (mergedBooks.length > 0) {
        if (typeof onLoadingStepUpdate === "function") {
            onLoadingStepUpdate(
                "Wikipedia & Open Library Verileri Birleştiriliyor...",
                "Detaylı kitap özeti, kapak görseli ve Wikipedia yazar biyografisi tamamlanıyor."
            );
        }

        await Promise.allSettled([
            completeMissingSummariesAndCovers(mergedBooks, query, signal),
            enrichAuthorsFromWikipedia(mergedBooks, signal)
        ]);

        mergedBooks = mergeAndRankMultiSourceBooks(mergedBooks, query);
    }

    if (
        mergedBooks.length === 0 &&
        trWikiOutcome.status === "rejected" &&
        openLibOutcome.status === "rejected" &&
        googleOutcome.status === "rejected"
    ) {
        throw new Error("İnternet kitap servislerine ulaşılamadı.");
    }

    return mergedBooks;
}

// ============================================================================
// 8. GÖRSEL TAMAMLAMA (CSS DİJİTAL KİTAP KAPAĞI) VE KART OLUŞTURMA
// ============================================================================

function createCssDigitalCoverElement(book) {
    const [colorStart, colorEnd] = book.palette || pickPaletteForTitle(book.title);

    const coverDiv = document.createElement("div");
    coverDiv.className = "css-digital-cover";
    coverDiv.style.setProperty("--cover-bg-start", colorStart);
    coverDiv.style.setProperty("--cover-bg-end", colorEnd);

    const frameDiv = document.createElement("div");
    frameDiv.className = "css-cover-frame";

    const topDiv = document.createElement("div");
    topDiv.className = "css-cover-top";

    const genreSpan = document.createElement("span");
    genreSpan.className = "css-cover-genre";
    genreSpan.textContent = (book.genre || "Edebiyat").split("/")[0].trim();

    const emblemDiv = document.createElement("div");
    emblemDiv.className = "css-cover-emblem";
    emblemDiv.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
    `;

    topDiv.appendChild(genreSpan);
    topDiv.appendChild(emblemDiv);

    const titleHeading = document.createElement("h4");
    titleHeading.className = "css-cover-title";
    titleHeading.textContent = book.title || "Kitap";

    const bottomDiv = document.createElement("div");
    bottomDiv.className = "css-cover-bottom";

    const divider = document.createElement("div");
    divider.className = "css-cover-divider";

    const authorSpan = document.createElement("span");
    authorSpan.className = "css-cover-author";
    authorSpan.textContent = book.author || "";

    bottomDiv.appendChild(divider);
    bottomDiv.appendChild(authorSpan);

    if (book.year && book.year !== "Belirtilmemiş") {
        const yearSpan = document.createElement("span");
        yearSpan.className = "css-cover-year";
        yearSpan.textContent = book.year;
        bottomDiv.appendChild(yearSpan);
    }

    frameDiv.appendChild(topDiv);
    frameDiv.appendChild(titleHeading);
    frameDiv.appendChild(bottomDiv);
    coverDiv.appendChild(frameDiv);

    return coverDiv;
}

function clearPreviousResults() {
    while (resultsContainer.firstChild) {
        resultsContainer.removeChild(resultsContainer.firstChild);
    }
    resultsContainer.classList.remove("single-result");
    resultsTitle.textContent = "";
    resultsCount.textContent = "";
}

function renderLoadingState(query) {
    clearPreviousResults();
    resultsHeader.classList.remove("hidden");
    resultsTitle.textContent = `"${query}" Aranıyor...`;
    resultsCount.textContent = "Wikipedia • Open Library • Google Books 🌐";

    const loadingCard = document.createElement("div");
    loadingCard.className = "loading-state-card";
    loadingCard.innerHTML = `
        <div class="loading-spinner" aria-hidden="true"></div>
        <h3 class="loading-title" id="loadingStepTitle">Açık Kaynak Kütüphaneler Taranıyor...</h3>
        <p class="loading-subtitle" id="loadingStepSubtitle"></p>
    `;
    loadingCard.querySelector("#loadingStepSubtitle").textContent =
        `"${query}" için Türkçe/İngilizce Wikipedia, Open Library ve Google Books verileri birleştiriliyor.`;
    resultsContainer.appendChild(loadingCard);
}

function updateLoadingStepText(titleText, subtitleText) {
    const titleEl = document.getElementById("loadingStepTitle");
    const subtitleEl = document.getElementById("loadingStepSubtitle");
    if (titleEl && titleText) titleEl.textContent = titleText;
    if (subtitleEl && subtitleText) subtitleEl.textContent = subtitleText;
}

function createBookCardElement(book, index = 0) {
    const article = document.createElement("article");
    article.className = "book-card";

    // 1. Kapak Görseli Alanı (Alt katman: CSS Dijital Kapak, Üst katman: Yüksek Çözünürlüklü Görsel)
    const coverWrapper = document.createElement("div");
    coverWrapper.className = "book-cover-wrapper";

    const cssDigitalCover = createCssDigitalCoverElement(book);
    coverWrapper.appendChild(cssDigitalCover);

    if (book.coverUrl) {
        const img = document.createElement("img");
        img.className = "book-cover-img";
        img.src = book.coverUrl;
        img.alt = `${book.title} - ${book.author} Kitap Kapağı`;
        img.loading = "lazy";

        img.addEventListener("error", () => {
            img.remove();
        });
        img.addEventListener("load", () => {
            if (img.naturalWidth <= 2 || img.naturalHeight <= 2) {
                img.remove();
            }
        });

        coverWrapper.appendChild(img);
    }

    // 2. Kitap Bilgileri Alanı
    const infoDiv = document.createElement("div");
    infoDiv.className = "book-info";

    const metaTop = document.createElement("div");
    metaTop.className = "book-meta-top";

    if (index === 0) {
        const bestMatchBadge = document.createElement("span");
        bestMatchBadge.className = "book-genre-badge";
        bestMatchBadge.textContent = "★ En Dolu & Doğru Eşleşme";
        metaTop.appendChild(bestMatchBadge);
    }

    const genreBadge = document.createElement("span");
    genreBadge.className = index === 0 ? "book-year-badge" : "book-genre-badge";
    genreBadge.textContent = book.genre || "Edebiyat";
    metaTop.appendChild(genreBadge);

    if (book.year && book.year !== "Belirtilmemiş") {
        const yearBadge = document.createElement("span");
        yearBadge.className = "book-year-badge";
        yearBadge.textContent = `Yayın: ${book.year}`;
        metaTop.appendChild(yearBadge);
    }

    // Sağ üst köşe veri kaynağı etiketi
    const sourceCornerBadge = document.createElement("span");
    sourceCornerBadge.className = `book-source-tag ${
        book.isCustomEdited ? "source-custom" : "source-library"
    }`;
    sourceCornerBadge.textContent = book.isCustomEdited
        ? "✏️ Kütüphanem (Düzenlendi)"
        : book.sourceLabel || "📚 Açık Kütüphane Verisi";
    metaTop.appendChild(sourceCornerBadge);

    // Kitap Adı
    const titleEl = document.createElement("h3");
    titleEl.className = "book-title";
    titleEl.textContent = book.fullTitle || book.title;

    // Yazar Adı
    const authorEl = document.createElement("p");
    authorEl.className = "book-author";
    authorEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
        </svg>
        <span></span>
    `;
    authorEl.querySelector("span").textContent = book.author;

    // Yazar Hakkında Kısa Tanıtım Kutusu (Wikipedia Biyografisi)
    const authorBioBox = document.createElement("div");
    authorBioBox.className = "author-bio-box";

    const authorBioLabel = document.createElement("span");
    authorBioLabel.className = "author-bio-label";
    authorBioLabel.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        <span>Yazar Hakkında Kısa Bilgi</span>
    `;

    const authorBioText = document.createElement("p");
    authorBioText.className = "author-bio-text";
    authorBioText.textContent =
        book.authorBio || buildDefaultAuthorBio(book.author, book.genre, book.year);

    authorBioBox.appendChild(authorBioLabel);
    authorBioBox.appendChild(authorBioText);

    // Detaylı Kitap Özeti Kutusu
    const summaryBox = document.createElement("div");
    summaryBox.className = "book-summary-box";

    const summaryLabel = document.createElement("span");
    summaryLabel.className = "book-summary-label";
    summaryLabel.innerHTML = `
        <span>Detaylı Kitap Özeti &amp; Açıklama</span>
    `;

    const summaryScroll = document.createElement("div");
    summaryScroll.className = "book-summary-scroll";

    const summaryText = document.createElement("p");
    summaryText.className = "book-summary";
    summaryText.textContent = book.summary;

    summaryScroll.appendChild(summaryText);
    summaryBox.appendChild(summaryLabel);
    summaryBox.appendChild(summaryScroll);

    // Alt Bilgi & Kullanıcı Katkısı ("✏️ Bilgileri Düzenle / Kütüphaneme Kaydet")
    const footerDiv = document.createElement("div");
    footerDiv.className = "book-footer";

    const pageStat = document.createElement("span");
    pageStat.className = "book-stat";
    pageStat.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        <span>${book.pages ? `${book.pages} Sayfa` : "Açık Kütüphane Kaydı"}</span>
    `;
    footerDiv.appendChild(pageStat);

    const actionsGroup = document.createElement("div");
    actionsGroup.className = "book-footer-actions";

    // "✏️ Bilgileri Düzenle / Kütüphaneme Kaydet" Butonu
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-edit-book";
    editBtn.textContent = "✏️ Bilgileri Düzenle / Kütüphaneme Kaydet";
    editBtn.title = "Kitap özetini veya yazar bilgilerini düzenleyip yerel veritabanınıza (localStorage) kalıcı olarak kaydedin";
    editBtn.addEventListener("click", () => {
        openEditBookModal(book);
    });
    actionsGroup.appendChild(editBtn);

    // Hızlı Kaydet / Kaldır Butonu
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    const isAlreadySaved = LocalBookLibrary.isSaved(book.id);
    saveBtn.className = `btn-save-book${isAlreadySaved ? " saved" : ""}`;
    saveBtn.textContent = isAlreadySaved ? "✓ Kitaplığımda Kayıtlı" : "+ Hızlı Kaydet";
    saveBtn.title = "Bu kitabı doğrudan yerel kitaplığınıza ekleyin veya kaldırın";

    saveBtn.addEventListener("click", () => {
        const nowSaved = LocalBookLibrary.toggleSaveBook(book);
        saveBtn.classList.toggle("saved", nowSaved);
        saveBtn.textContent = nowSaved ? "✓ Kitaplığımda Kayıtlı" : "+ Hızlı Kaydet";
    });
    actionsGroup.appendChild(saveBtn);

    if (book.infoLink) {
        const externalLink = document.createElement("a");
        externalLink.className = "book-link";
        externalLink.href = book.infoLink;
        externalLink.target = "_blank";
        externalLink.rel = "noopener noreferrer";
        externalLink.innerHTML = `
            <span>Kaynağa Git</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
        `;
        actionsGroup.appendChild(externalLink);
    }

    footerDiv.appendChild(actionsGroup);

    infoDiv.appendChild(metaTop);
    infoDiv.appendChild(titleEl);
    infoDiv.appendChild(authorEl);
    infoDiv.appendChild(authorBioBox);
    infoDiv.appendChild(summaryBox);
    infoDiv.appendChild(footerDiv);

    article.appendChild(coverWrapper);
    article.appendChild(infoDiv);

    return article;
}

function renderEmptyState(query, isNetworkError = false) {
    clearPreviousResults();
    resultsHeader.classList.remove("hidden");
    resultsTitle.textContent = isNetworkError ? "Bağlantı Hatası" : "Arama Sonucu";
    resultsCount.textContent = "0 eşleşme";

    const emptyCard = document.createElement("div");
    emptyCard.className = "empty-state-card";

    const illustration = document.createElement("div");
    illustration.className = "empty-state-illustration";
    illustration.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
        </svg>
    `;

    const title = document.createElement("h3");
    title.className = "empty-state-title";
    title.textContent = isNetworkError ? "İnternet Servisine Ulaşılamadı" : "Kitap bulunamadı ✨";

    const description = document.createElement("p");
    description.className = "empty-state-text";

    if (isNetworkError) {
        description.textContent =
            "Kütüphane servislerine bağlanırken bir ağ sorunu oluştu. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.";
    } else {
        description.innerHTML = `"<span class="empty-state-query"></span>" araması için Wikipedia, Open Library ve Google Books kaynaklarında eşleşen bir kayıt bulamadık. Çok yeni bir kitapsa aşağıdan kendi özetinizle kütüphanenize ekleyebilirsiniz.`;
        description.querySelector(".empty-state-query").textContent = query;
    }

    const addCustomBtn = document.createElement("button");
    addCustomBtn.type = "button";
    addCustomBtn.className = "btn-edit-book";
    addCustomBtn.textContent = `✏️ "${query}" Kitabını Kütüphaneme Kendim Ekleyeyim`;
    addCustomBtn.addEventListener("click", () => {
        openEditBookModal({
            id: `custom_${Date.now()}`,
            title: query,
            fullTitle: query,
            author: "",
            year: new Date().getFullYear().toString(),
            genre: "Edebiyat & Roman",
            pages: null,
            coverUrl: "",
            authorBio: "",
            summary: ""
        });
    });

    emptyCard.appendChild(illustration);
    emptyCard.appendChild(title);
    emptyCard.appendChild(description);
    emptyCard.appendChild(addCustomBtn);

    resultsContainer.appendChild(emptyCard);
}

function renderBookList(books, headerText, badgeText) {
    clearPreviousResults();
    currentDisplayedBooks = Array.isArray(books) ? [...books] : [];

    resultsHeader.classList.remove("hidden");
    resultsTitle.textContent = headerText;
    resultsCount.textContent = badgeText;

    if (books.length === 1) {
        resultsContainer.classList.add("single-result");
    }

    const fragment = document.createDocumentFragment();
    books.forEach((book, index) => {
        fragment.appendChild(createBookCardElement(book, index));
    });
    resultsContainer.appendChild(fragment);
}

// ============================================================================
// 9. KULLANICI KATKISI MODAL İŞLEMLERİ ("✏️ Bilgileri Düzenle / Kütüphaneme Kaydet")
// ============================================================================

function openEditBookModal(book = null) {
    const targetBook = book || {
        id: `custom_${Date.now()}`,
        title: searchInput.value.trim() || "",
        author: "",
        year: "",
        genre: "Edebiyat & Roman",
        pages: "",
        coverUrl: "",
        authorBio: "",
        summary: ""
    };

    editBookIdInput.value = targetBook.id || `custom_${Date.now()}`;
    editBookTitleInput.value = targetBook.title || "";
    editBookAuthorInput.value =
        targetBook.author && targetBook.author !== "Yazar Bilgisi Belirtilmemiş"
            ? targetBook.author
            : "";
    editBookYearInput.value =
        targetBook.year && targetBook.year !== "Belirtilmemiş" ? targetBook.year : "";
    editBookGenreInput.value = targetBook.genre || "Edebiyat & Roman";
    editBookPagesInput.value = targetBook.pages || "";
    editBookCoverUrlInput.value = targetBook.coverUrl || "";
    editBookAuthorBioInput.value = targetBook.authorBio || "";
    editBookSummaryInput.value = targetBook.summary || "";

    editBookModal.classList.remove("hidden");
    setTimeout(() => editBookSummaryInput.focus(), 50);
}

function closeEditBookModal() {
    editBookModal.classList.add("hidden");
}

function handleSaveEditedBookForm(event) {
    event.preventDefault();

    const id = editBookIdInput.value.trim() || `custom_${Date.now()}`;
    const title = cleanUnicodeText(editBookTitleInput.value.trim());
    const author =
        cleanUnicodeText(editBookAuthorInput.value.trim()) || "Yazar Bilgisi Belirtilmemiş";
    const year = cleanUnicodeText(editBookYearInput.value.trim()) || "Belirtilmemiş";
    const genre = cleanUnicodeText(editBookGenreInput.value.trim()) || "Edebiyat & Roman";
    const pages = Number(editBookPagesInput.value) > 0 ? Number(editBookPagesInput.value) : null;
    const coverUrl = editBookCoverUrlInput.value.trim();
    const summary = editBookSummaryInput.value.trim();
    const authorBio =
        editBookAuthorBioInput.value.trim() || buildDefaultAuthorBio(author, genre, year);

    if (!title || !summary) return;

    const existingIndex = currentDisplayedBooks.findIndex((b) => b.id === id);
    const existingBook = existingIndex !== -1 ? currentDisplayedBooks[existingIndex] : {};

    const updatedBook = {
        ...existingBook,
        id,
        title,
        fullTitle: title,
        originalTitle: existingBook.originalTitle || title,
        author,
        authorBio,
        hasRichAuthorBio: true,
        year,
        pages,
        genre,
        coverUrl,
        summary,
        hasRichDescription: true,
        isTurkishContent: true,
        isEditionMatched: true,
        isCustomEdited: true,
        sourceLabel: "✏️ Kütüphanem (Düzenlendi)",
        popularityScore: Math.max(existingBook.popularityScore || 0, 300),
        infoLink:
            existingBook.infoLink ||
            `https://tr.wikipedia.org/w/index.php?search=${encodeURIComponent(title)}`,
        palette: existingBook.palette || pickPaletteForTitle(title)
    };

    // 1. Yerel veritabanına (localStorage) kalıcı olarak kaydet
    LocalBookLibrary.saveOrUpdateBook(updatedBook);

    // 2. Mevcut ekrandaki listeyi ve arama önbelleğini güncelle
    if (existingIndex !== -1) {
        currentDisplayedBooks[existingIndex] = updatedBook;
    } else {
        currentDisplayedBooks = [updatedBook, ...currentDisplayedBooks];
    }

    if (currentActiveQuery) {
        SearchResultCache.set(currentActiveQuery, currentDisplayedBooks);
    }
    SearchResultCache.set(title, [updatedBook]);

    renderBookList(
        currentDisplayedBooks,
        currentActiveQuery
            ? `"${currentActiveQuery}" İçin Arama Sonuçları`
            : "Kitaplığım (Kaydedilen ve Düzenlenen Kitaplar)",
        `${currentDisplayedBooks.length} kitap (Yerel Veritabanına Kaydedildi ✓)`
    );

    closeEditBookModal();
}

// ============================================================================
// 10. ANA ARAMA AKIŞI (ÖNBELLEK DESTEKLİ & 429 KORUMALI)
// ============================================================================

async function performLiveBookSearch(rawQuery) {
    const cleanQuery = (rawQuery || "").trim();
    if (!cleanQuery) return;

    currentActiveQuery = cleanQuery;

    if (activeSearchController) {
        activeSearchController.abort();
        activeSearchController = null;
    }

    // 1. Önbellek (localStorage Cache) ve Yerel Kütüphane Kontrolü
    const cachedBooks = SearchResultCache.get(cleanQuery);
    const savedMatches = LocalBookLibrary.searchSavedBooks(cleanQuery);

    if (cachedBooks && cachedBooks.length > 0) {
        const mergedCached = mergeAndRankMultiSourceBooks(
            [...savedMatches, ...cachedBooks],
            cleanQuery
        );
        renderBookList(
            mergedCached,
            `"${cleanQuery}" İçin Arama Sonuçları`,
            `${mergedCached.length} kitap (Önbellekten Hızlı Yüklendi ⚡)`
        );
        return;
    }

    renderLoadingState(cleanQuery);

    const controller = new AbortController();
    activeSearchController = controller;

    try {
        const liveBooks = await fetchOpenSourceBooks(
            cleanQuery,
            controller.signal,
            updateLoadingStepText
        );

        if (controller.signal.aborted) return;

        if (!liveBooks || liveBooks.length === 0) {
            renderEmptyState(cleanQuery, false);
            return;
        }

        // Sonuçları localStorage önbelleğine kaydet
        SearchResultCache.set(cleanQuery, liveBooks);

        renderBookList(
            liveBooks,
            `"${cleanQuery}" İçin Arama Sonuçları`,
            `${liveBooks.length} kitap bulundu (Wikipedia • Open Library • Google Books 🌐)`
        );
    } catch (error) {
        if (error.name === "AbortError") return;
        console.error("Kitap arama hatası:", error);
        renderEmptyState(cleanQuery, true);
    } finally {
        if (activeSearchController === controller) {
            activeSearchController = null;
        }
    }
}

function showSavedBooksLibrary() {
    currentActiveQuery = "";
    const savedBooks = LocalBookLibrary.getAllList();

    if (savedBooks.length > 0) {
        renderBookList(
            savedBooks,
            "Kitaplığım (Kaydedilen ve Düzenlenen Kitaplar)",
            `${savedBooks.length} kayıtlı kitap 📌`
        );
    } else {
        clearPreviousResults();
        resultsHeader.classList.remove("hidden");
        resultsTitle.textContent = "Kitaplığım";
        resultsCount.textContent = "0 kayıtlı kitap";

        const emptyCard = document.createElement("div");
        emptyCard.className = "empty-state-card";
        emptyCard.innerHTML = `
            <h3 class="empty-state-title">Kitaplığınız Henüz Boş 📌</h3>
            <p class="empty-state-text">Yukarıdaki arama çubuğundan dilediğiniz kitabı aratıp kart üzerindeki <strong>"✏️ Bilgileri Düzenle / Kütüphaneme Kaydet"</strong> butonuyla buraya ekleyebilirsiniz.</p>
        `;
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn-edit-book";
        addBtn.textContent = "✏️ Yeni Kitap Ekle";
        addBtn.addEventListener("click", () => openEditBookModal(null));
        emptyCard.appendChild(addBtn);

        resultsContainer.appendChild(emptyCard);
    }
}

// ============================================================================
// 11. TEMA, MODAL VE OLAY DİNLEYİCİLERİ (OTOMATİK ARAMA YOKTUR)
// ============================================================================

function toggleClearButton() {
    if (searchInput.value.trim().length > 0) {
        clearInputBtn.classList.remove("hidden");
    } else {
        clearInputBtn.classList.add("hidden");
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    const prefersDark =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = savedTheme || (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", initialTheme);

    themeToggle.addEventListener("click", () => {
        const currentTheme = document.documentElement.getAttribute("data-theme");
        const nextTheme = currentTheme === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", nextTheme);
        localStorage.setItem(STORAGE_KEYS.THEME, nextTheme);
    });
}

function initEditModalEvents() {
    if (addCustomBookBtn) {
        addCustomBookBtn.addEventListener("click", () => {
            openEditBookModal(null);
        });
    }

    closeEditModalBtn.addEventListener("click", closeEditBookModal);
    cancelEditBookBtn.addEventListener("click", closeEditBookModal);

    editBookModal.addEventListener("click", (event) => {
        if (event.target === editBookModal) {
            closeEditBookModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !editBookModal.classList.contains("hidden")) {
            closeEditBookModal();
        }
    });

    editBookForm.addEventListener("submit", handleSaveEditedBookForm);
}

function initApp() {
    initTheme();
    initEditModalEvents();
    updateSavedCounterUI();

    // Sadece "Kitap Ara" butonuna veya Enter tuşuna basıldığında arama yapılır (sayfa açılışında otomatik arama yapılmaz)
    searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;
        performLiveBookSearch(query);
    });

    searchInput.addEventListener("input", () => {
        toggleClearButton();
    });

    clearInputBtn.addEventListener("click", () => {
        if (activeSearchController) {
            activeSearchController.abort();
            activeSearchController = null;
        }
        searchInput.value = "";
        toggleClearButton();
        clearPreviousResults();
        resultsHeader.classList.add("hidden");
        searchInput.focus();
    });

    showAllBtn.addEventListener("click", () => {
        searchInput.value = "";
        toggleClearButton();
        showSavedBooksLibrary();
    });

    brandReset.addEventListener("click", (event) => {
        event.preventDefault();
        if (activeSearchController) {
            activeSearchController.abort();
            activeSearchController = null;
        }
        searchInput.value = "";
        toggleClearButton();
        clearPreviousResults();
        resultsHeader.classList.add("hidden");
        searchInput.focus();
    });
}

document.addEventListener("DOMContentLoaded", initApp);
