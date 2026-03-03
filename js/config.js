export const APP_CONFIG = {
    EARTH_RADIUS_KM: 6371,
    DEFAULT_LAND_HEX: "#334155",
    PATHS: {
        COUNTRIES: { local: "./data/countries.geojson", remote: "nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson" },
        REGIONS: { local: "./data/regions.geojson", remote: "nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson" },
        RIVERS: { local: "./data/rivers.geojson", remote: "nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson" },
        LAKES: { local: "./data/lakes.geojson", remote: "nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson" },
        ITALY: { local: "./data/italy.geojson", remote: "openpolis/geojson-italy/master/geojson/limits_IT_regions.geojson" }
    }
};

export const MAP_SOURCES = {
    world_complete: { paths: APP_CONFIG.PATHS.COUNTRIES, name: "Mondo Completo", prefill: true },
    world_countries: { paths: APP_CONFIG.PATHS.COUNTRIES, name: "Mondo (Nazioni)", prefill: false },
    world_regions: { paths: APP_CONFIG.PATHS.REGIONS, name: "Mondo (Regioni)", prefill: false },
    eu_countries: { paths: APP_CONFIG.PATHS.COUNTRIES, name: "Europa (Nazioni)", prefill: false, continent: ["Europe"] },
    eu_regions: { paths: APP_CONFIG.PATHS.REGIONS, name: "Europa (Regioni)", prefill: false, continent: ["Europe"] },
    as_countries: { paths: APP_CONFIG.PATHS.COUNTRIES, name: "Asia (Nazioni)", prefill: false, continent: ["Asia"] },
    as_regions: { paths: APP_CONFIG.PATHS.REGIONS, name: "Asia (Regioni)", prefill: false, continent: ["Asia"] },
    am_countries: { paths: APP_CONFIG.PATHS.COUNTRIES, name: "Americhe (Nazioni)", prefill: false, continent: ["North America", "South America"] },
    am_regions: { paths: APP_CONFIG.PATHS.REGIONS, name: "Americhe (Regioni)", prefill: false, continent: ["North America", "South America"] },
    af_countries: { paths: APP_CONFIG.PATHS.COUNTRIES, name: "Africa (Nazioni)", prefill: false, continent: ["Africa"] },
    af_regions: { paths: APP_CONFIG.PATHS.REGIONS, name: "Africa (Regioni)", prefill: false, continent: ["Africa"] },
    italy: { paths: APP_CONFIG.PATHS.ITALY, name: "Italia", prefill: false },
    usa: { paths: APP_CONFIG.PATHS.REGIONS, name: "USA", prefill: false, countryFilter: "United States of America" }
};

export async function fetchWithFallback(pathObj) {
    try {
        let res = await fetch(pathObj.local);
        if (res.ok) return await res.json();
    } catch(e) { console.warn(`Fallback: ${pathObj.local} non trovato. Connessione al Cloud...`); } 

    const urls = [
        `https://raw.githack.com/${pathObj.remote}`, 
        `https://raw.githubusercontent.com/${pathObj.remote}`, 
        `https://cdn.jsdelivr.net/gh/${pathObj.remote.replace('/master/', '@master/')}` 
    ];
    for (let url of urls) {
        try {
            let res = await fetch(url);
            if (res.ok) return await res.json();
        } catch(e) {}
    }
    throw new Error("Nessuna sorgente dati disponibile.");
}

export function showToast(msg, isError = false) {
    const t = document.getElementById("toast");
    t.textContent = msg; 
    t.style.background = isError ? "var(--danger)" : "var(--success)";
    t.style.opacity = 1; t.style.transform = "translateX(-50%) translateY(-10px)";
    setTimeout(() => { t.style.opacity = 0; t.style.transform = "translateX(-50%) translateY(0)"; }, 3000);
}