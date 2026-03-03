import { APP_CONFIG, MAP_SOURCES, fetchWithFallback, showToast } from './config.js';
import { GISMapEngine } from './MapEngine.js';

const engine = new GISMapEngine();

// --- UI BINDINGS ---
document.getElementById('menu-toggle-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
document.getElementById('map-container').onclick = () => { if(window.innerWidth < 1000) document.getElementById('sidebar').classList.remove('open'); };

document.getElementById('btn-zoom-in').onclick = () => engine.svg.transition().duration(300).call(engine.zoomBehavior.scaleBy, 1.5);
document.getElementById('btn-zoom-out').onclick = () => engine.svg.transition().duration(300).call(engine.zoomBehavior.scaleBy, 0.66);
document.getElementById('btn-fullscreen').onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else if (document.exitFullscreen) document.exitFullscreen();
};
document.addEventListener('fullscreenchange', () => document.getElementById('btn-fullscreen').innerHTML = document.fullscreenElement ? "🗗" : "⛶");

function refreshSlots() {
    try {
        for (let i = 1; i <= 3; i++) {
            const data = localStorage.getItem(`mapchart_pro_final_v3_${i}`);
            let text = `Slot ${i}: Vuoto`;
            if (data) { try { const p = JSON.parse(data); if(p.mapType) text = `Slot ${i}: ${MAP_SOURCES[p.mapType].name}`; } catch(e){} }
            document.getElementById('menuSaveSlot').options[i-1].text = text;
        }
    } catch(e) {}
}
refreshSlots();

document.getElementById('btnStartNew').onclick = () => bootApp(document.getElementById('startMapSelector').value);
document.getElementById('btnLoadLocal').onclick = () => {
    const slot = document.getElementById('menuSaveSlot').value;
    const data = localStorage.getItem(`mapchart_pro_final_v3_${slot.replace('slot_','')}`);
    if (data) { const p = JSON.parse(data); bootApp(p.mapType, p, slot); } else showToast("Slot vuoto", true);
};
document.getElementById('importProjectFile').onchange = e => document.getElementById('fileNameDisplay').textContent = e.target.files.length > 0 ? e.target.files[0].name : "Nessun file...";
document.getElementById('btnImportProject').onclick = () => {
    const fi = document.getElementById('importProjectFile'); if(!fi.files.length) return;
    const r = new FileReader();
    r.onload = e => { try { const d = JSON.parse(e.target.result); bootApp(d.mapType, d, 'slot_1'); } catch(err){showToast("JSON Corrotto", true);} };
    r.readAsText(fi.files[0]);
};

async function bootApp(mapType, stateData=null, targetSlot='slot_1') {
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('editor-ui').style.display = 'block';
    document.getElementById('menu-toggle-btn').style.display = 'flex';
    document.getElementById('map-controls').style.display = 'flex';
    document.getElementById('currentMapDisplay').textContent = MAP_SOURCES[mapType].name;
    document.getElementById('editorSaveSlot').value = targetSlot;
    if (window.innerWidth > 1000) document.getElementById('sidebar').classList.add('open');

    engine.currentMapType = mapType;
    const isGlobal = mapType.startsWith('world_');
    const btn3D = document.getElementById('toggle3DBtn');
    if (!isGlobal) {
        engine.proj2D = (mapType === 'usa') ? d3.geoAlbersUsa() : d3.geoMercator();
        btn3D.disabled = true; btn3D.style.opacity = "0.3"; btn3D.title = "Solo mappe mondiali";
        if(engine.is3D) { engine.is3D = false; btn3D.innerHTML="🌍 ATTIVA GLOBO 3D"; document.getElementById('toggleSpinBtn').style.display="none"; engine.oceanSphere.style("display","none"); engine.svg.classed("is-spinning",false).classed("is-dragging",false);}
    } else {
        engine.proj2D = d3.geoMercator();
        btn3D.disabled = false; btn3D.style.opacity = "1"; btn3D.title = "";
    }

    document.getElementById('loading').style.display = 'block';
    engine.resize();

    try {
        let geoData = await fetchWithFallback(MAP_SOURCES[mapType].paths);
        
        if (MAP_SOURCES[mapType].continent) {
            let valids = null;
            if (MAP_SOURCES[mapType].paths === APP_CONFIG.PATHS.REGIONS) {
                let adm0 = await fetchWithFallback(APP_CONFIG.PATHS.COUNTRIES);
                valids = new Set(adm0.features.filter(f=>MAP_SOURCES[mapType].continent.includes(f.properties.CONTINENT)).map(f=>f.properties.ADMIN));
            }
            geoData.features = geoData.features.filter(d => {
                let k = false; const an = d.properties.admin || d.properties.NAME;
                if(valids) k = valids.has(an); else { const c = d.properties.CONTINENT; k = c ? MAP_SOURCES[mapType].continent.includes(c) : false; }
                if(k && MAP_SOURCES[mapType].paths === APP_CONFIG.PATHS.REGIONS && an==="Russia" && MAP_SOURCES[mapType].continent.includes("Europe") && d3.geoCentroid(d)[0]>=60) k=false;
                return k;
            });
        } else if (MAP_SOURCES[mapType].countryFilter) {
            geoData.features = geoData.features.filter(d => (d.properties.admin || d.properties.NAME) === MAP_SOURCES[mapType].countryFilter);
        }

        geoData.features.forEach(d => { d.properties._a = d3.geoArea(d) * APP_CONFIG.EARTH_RADIUS_KM * APP_CONFIG.EARTH_RADIUS_KM; d.properties._c = APP_CONFIG.DEFAULT_LAND_HEX; d.properties._p = 0; });
        engine.features = geoData.features;
        engine.tacticalMarkers = [];
        
        if(!engine.is3D) { engine.g.attr("transform", null); engine.svg.call(engine.zoomBehavior.transform, d3.zoomIdentity); }
        engine.updateProjection();
        engine.applyInteractions();

        engine.g.selectAll("*").remove();
        engine.gBase = engine.g.append("g"); engine.gRivers = engine.g.append("g"); engine.gLakes = engine.g.append("g"); engine.gLabels = engine.g.append("g");

        engine.gBase.selectAll("path").data(geoData.features).enter().append("path")
            .attr("class", "area").attr("id", (d,i) => `path-${i}`).attr("d", engine.pathGen).attr("fill", APP_CONFIG.DEFAULT_LAND_HEX)
            .on("mouseover", (e, d) => {
                const an = engine.getAreaName(d); const nn = engine.getNationName(d);
                let t = `<b>${an}</b>`; if(an!==nn) t+= `<br><span style="font-size:10px;color:var(--accent)">${nn}</span>`;
                if(d.properties._f) t+= `<br><span style="font-size:11px;color:#facc15">● ${d.properties._f}</span>`;
                const pop = d.properties._p || 0;
                if(pop>0) t+=`<hr style="border:0; border-top:1px solid var(--border-light); margin:6px 0;"><span style="font-size:11px; color:var(--success);">Pop: ${pop.toLocaleString()} | Dens: ${(pop/d.properties._a).toFixed(1)}</span>`;
                engine.tooltip.style("opacity", 1).html(t);
            })
            .on("mousemove", e => engine.tooltip.style("left", (e.pageX+15)+"px").style("top", (e.pageY-15)+"px"))
            .on("mouseout", () => engine.tooltip.style("opacity", 0))
            .on("click", (e, d) => engine.colorAndZoom(d, false));

        if(stateData) engine.applyState(stateData);
        engine.history = []; engine.historyIndex = -1; engine.pushState();

        setTimeout(async () => {
            try {
                const [r, l] = await Promise.all([fetchWithFallback(APP_CONFIG.PATHS.RIVERS), fetchWithFallback(APP_CONFIG.PATHS.LAKES)]);
                let rf = r.features; let lf = l.features;
                if (!isGlobal) {
                    const mb = d3.geoBounds({type: "FeatureCollection", features: engine.features});
                    const inB = f => { const c = d3.geoCentroid(f); if(isNaN(c[0]))return false; let inL=c[0]>=mb[0][0]-5&&c[0]<=mb[1][0]+5; if(mb[0][0]>mb[1][0]) inL=c[0]>=mb[0][0]-5||c[0]<=mb[1][0]+5; return inL && c[1]>=mb[0][1]-5 && c[1]<=mb[1][1]+5; };
                    rf = rf.filter(inB); lf = lf.filter(inB);
                }
                engine.gRivers.selectAll("path").data(rf).enter().append("path").attr("class", "river").attr("d", engine.pathGen);
                engine.gLakes.selectAll("path").data(lf).enter().append("path").attr("class", "lake").attr("d", engine.pathGen);
                engine.gRivers.style("display", engine.showWater?"block":"none"); engine.gLakes.style("display", engine.showWater?"block":"none");
            } catch(e) {}
        }, 50);

    } catch (e) { showToast("Avvio fallito.", true); }
    document.getElementById('loading').style.display = 'none';
}

// --- CONTROLLI UI AGGIUNTIVI ---
document.getElementById('searchInput').oninput = e => engine.execSearch(e.target.value);
document.addEventListener('keydown', e => { if (document.getElementById('editor-ui').style.display !== 'none') { if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase()==='z') { e.preventDefault(); engine.undo(); } else if (e.ctrlKey && (e.key.toLowerCase()==='y' || (e.shiftKey && e.key.toLowerCase()==='z'))) { e.preventDefault(); engine.redo(); } } });

document.getElementById('colorPicker').onchange = e => engine.currentColor = e.target.value;
document.getElementById('eraserBtn').onclick = () => { engine.currentColor = APP_CONFIG.DEFAULT_LAND_HEX; document.getElementById('colorHex').textContent = "GOMMA"; document.getElementById('factionNameInput').value = ""; };

document.getElementById('toggleLabelsBtn').onclick = e => { engine.showLabels = !engine.showLabels; e.target.style.opacity = engine.showLabels ? "1" : "0.5"; engine.renderDecorations(); };
document.getElementById('toggleWaterBtn').onclick = e => { engine.showWater = !engine.showWater; e.target.style.opacity = engine.showWater ? "1" : "0.5"; engine.gRivers.style("display", engine.showWater ? "block" : "none"); engine.gLakes.style("display", engine.showWater ? "block" : "none"); };

document.getElementById('toggle3DBtn').onclick = e => {
    if (!engine.currentMapType.startsWith('world_')) return;
    engine.is3D = !engine.is3D;
    e.target.innerHTML = engine.is3D ? "🗺️ RITORNA A 2D" : "🌍 ATTIVA GLOBO 3D";
    e.target.style.background = engine.is3D ? "linear-gradient(45deg, #10b981, #3b82f6)" : "";
    const spinBtn = document.getElementById('toggleSpinBtn');
    if (engine.is3D) { engine.autoSpin = true; spinBtn.style.display = "block"; spinBtn.innerHTML = "⏸️ FERMA ROTAZIONE"; } 
    else { engine.autoSpin = false; spinBtn.style.display = "none"; engine.svg.classed("is-spinning", false); engine.g.attr("transform", null); engine.svg.call(engine.zoomBehavior.transform, d3.zoomIdentity); }
    engine.updateProjection(); engine.applyInteractions();
};

document.getElementById('toggleSpinBtn').onclick = e => { engine.autoSpin = !engine.autoSpin; e.target.innerHTML = engine.autoSpin ? "⏸️ FERMA ROTAZIONE" : "▶️ AVVIA ROTAZIONE"; };

document.getElementById('btnSaveExit').onclick = () => {
    localStorage.setItem(`mapchart_pro_final_v3_${document.getElementById('editorSaveSlot').value.replace('slot_','')}`, JSON.stringify(engine.generateState()));
    document.getElementById('editor-ui').style.display='none'; document.getElementById('map-controls').style.display='none'; document.getElementById('menu-toggle-btn').style.display='none'; document.getElementById('main-menu').style.display='flex'; refreshSlots(); showToast("Salvato!");
};

document.getElementById('btnExportProject').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(engine.generateState())], {type:"application/json"})); a.download = `MegaMap_${Date.now()}.json`; a.click(); };

document.getElementById('exportPng').onclick = async () => renderExport('png');
document.getElementById('exportJpg').onclick = async () => renderExport('jpg');
document.getElementById('exportPdf').onclick = async () => renderExport('pdf');

async function renderExport(fmt) {
    showToast("Rendering HQ...", false);
    const trans = d3.zoomTransform(engine.svg.node()); const scl3 = engine.proj3D.scale(); const wasLab = engine.showLabels;
    engine.showLabels = false; engine.renderDecorations(); engine.tooltip.style("opacity",0);
    document.getElementById('menu-toggle-btn').style.display='none'; document.getElementById('map-controls').style.display='none';
    if(!engine.is3D) engine.svg.call(engine.zoomBehavior.transform, d3.zoomIdentity);
    await new Promise(r => setTimeout(r, 100));

    let svgStr = new XMLSerializer().serializeToString(engine.svg.node());
    if(!svgStr.includes('xmlns="http://www.w3.org/2000/svg"')) svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = new Image(); img.src = URL.createObjectURL(new Blob([svgStr], {type: "image/svg+xml;charset=utf-8"}));
    img.onload = () => {
        const cvs = document.createElement('canvas'); cvs.width = engine.width * 2; cvs.height = engine.height * 2;
        const ctx = cvs.getContext('2d'); ctx.fillStyle = "#0f172a"; ctx.fillRect(0,0,cvs.width,cvs.height); ctx.scale(2,2); ctx.drawImage(img,0,0);
        
        if (fmt==='pdf') {
            const pdf = new window.jspdf.jsPDF({orientation:'landscape', unit:'px', format:[cvs.width, cvs.height]});
            pdf.addImage(cvs.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, cvs.width, cvs.height); pdf.save(`MegaMap_${Date.now()}.pdf`);
        } else {
            const a = document.createElement('a'); a.download = `MegaMap_${Date.now()}.${fmt}`; a.href = cvs.toDataURL(`image/${fmt==='jpg'?'jpeg':'png'}`, 0.95); a.click();
        }
        
        if(!engine.is3D) engine.svg.call(engine.zoomBehavior.transform, trans); else { engine.proj3D.scale(scl3); engine.updatePathsFast(); }
        engine.showLabels = wasLab; engine.renderDecorations();
        document.getElementById('menu-toggle-btn').style.display='flex'; document.getElementById('map-controls').style.display='flex';
    };
}