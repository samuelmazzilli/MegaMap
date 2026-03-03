import { APP_CONFIG, showToast } from './config.js';

export class GISMapEngine {
    constructor() {
        console.log('%c MegaMap PRO Booting...', 'color: #2563eb; font-weight: bold; font-size: 16px;');
        this.container = d3.select("#map-container");
        this.svg = d3.select("#world-map");
        this.tooltip = d3.select("#tooltip");
        
        const defs = this.svg.append("defs");
        const grad = defs.append("radialGradient").attr("id", "globe-glow").attr("cx", "50%").attr("cy", "50%").attr("r", "50%");
        grad.append("stop").attr("offset", "75%").attr("stop-color", "#1e293b"); 
        grad.append("stop").attr("offset", "100%").attr("stop-color", "#020617"); 

        this.oceanSphere = this.svg.append("circle").attr("id", "ocean-sphere").attr("fill", "url(#globe-glow)").style("display", "none").style("pointer-events", "all");
        this.g = this.svg.append("g");
        
        this.proj2D = d3.geoMercator();
        this.proj3D = d3.geoOrthographic().clipAngle(90);
        this.pathGen = null;
        
        this.is3D = false; this.autoSpin = false; this.isDragging = false;
        this.rotation = [0, 0, 0];
        
        this.features = []; this.tacticalMarkers = [];
        this.showWater = true; this.showLabels = false;
        this.currentMode = "political";
        this.currentColor = APP_CONFIG.DEFAULT_LAND_HEX;
        
        this.history = []; this.historyIndex = -1; this.isApplyingState = false;

        this.setupInteractions();
    }

    resize() {
        const rect = this.container.node().getBoundingClientRect();
        this.width = rect.width > 100 ? rect.width : window.innerWidth;
        this.height = rect.height > 100 ? rect.height : window.innerHeight;
    }

    getNationName(d) { return d.properties.SOVEREIGNT || d.properties.ADMIN || d.properties.admin || d.properties.admin0 || d.properties.NAME || "Sconosciuta"; }
    getAreaName(d) { return d.properties.name || d.properties.NAME || d.properties.reg_name || this.getNationName(d); }
    getGroupName(d) { return (this.currentMapType && this.currentMapType.includes('regions')) || this.currentMapType === 'italy' || this.currentMapType === 'usa' ? this.getAreaName(d) : this.getNationName(d); }
    getBestCentroid(d) { return d3.geoCentroid(d); }

    setupInteractions() {
        d3.timer(() => {
            if (this.is3D && this.autoSpin && !this.isDragging) {
                this.rotation[0] += 0.20; this.proj3D.rotate(this.rotation);
                if (!this.svg.classed("is-spinning")) this.svg.classed("is-spinning", true);
                if(this.gBase) this.gBase.selectAll("path").attr("d", this.pathGen);
            }
        });

        this.zoomBehavior = d3.zoom().scaleExtent([1, 60]).on("zoom", e => {
            if (this.is3D) {
                const margin = window.innerWidth < 768 ? 30 : 50;
                const baseR = Math.max(10, (Math.min(this.width, this.height) / 2) - margin);
                this.proj3D.scale(baseR * e.transform.k);
                this.oceanSphere.attr("r", this.proj3D.scale());
                this.updatePaths();
            } else {
                this.g.attr("transform", e.transform);
                this.renderDecorations();
            }
        });

        let frame = null;
        this.drag3D = d3.drag()
            .on("start", e => {
                if (!this.is3D) return;
                this.isDragging = true; this.v0 = [e.x, e.y]; this.r0 = this.proj3D.rotate();
                this.svg.classed("is-dragging", true).classed("is-spinning", false);
                if (this.autoSpin) { this.autoSpin = false; document.getElementById('toggleSpinBtn').innerHTML = "▶️ AVVIA ROTAZIONE"; document.getElementById('toggleSpinBtn').style.color="var(--success)";}
            })
            .on("drag", e => {
                if (!this.is3D) return;
                const k = 75 / this.proj3D.scale();
                let pitch = Math.max(-90, Math.min(90, this.r0[1] - (e.y - this.v0[1]) * k));
                this.rotation = [this.r0[0] + (e.x - this.v0[0]) * k, pitch, this.r0[2]];
                if(!frame) {
                    frame = requestAnimationFrame(() => {
                        this.proj3D.rotate(this.rotation);
                        if(this.gBase) this.gBase.selectAll("path").attr("d", this.pathGen);
                        frame = null;
                    });
                }
            })
            .on("end", () => {
                if (!this.is3D) return;
                this.isDragging = false; this.svg.classed("is-dragging", false);
                if(frame) { cancelAnimationFrame(frame); frame = null; }
                this.updatePaths();
            });

        this.svg.on("contextmenu", e => {
            e.preventDefault();
            const pointer = d3.pointer(e);
            let coords;
            if (this.is3D) coords = this.proj3D.invert(pointer);
            else coords = this.proj2D.invert(d3.zoomTransform(this.svg.node()).invert(pointer));
            
            if(coords && !isNaN(coords[0])) {
                this.tacticalMarkers.push({ lon: coords[0], lat: coords[1] });
                this.renderDecorations(); showToast("📍 Marker Posizionato!");
                this.pushState();
            }
        });
    }

    applyInteractions() {
        if (this.is3D) {
            this.svg.on(".zoom", null);
            this.svg.call(this.zoomBehavior).call(this.drag3D);
            this.oceanSphere.call(this.drag3D);
        } else {
            this.svg.on(".drag", null); this.oceanSphere.on(".drag", null);
            this.svg.call(this.zoomBehavior);
        }
    }

    updateProjection() {
        this.resize();
        const margin = window.innerWidth < 768 ? 30 : 50;
        const radius = Math.max(10, (Math.min(this.width, this.height) / 2) - margin);

        if (this.is3D) {
            this.oceanSphere.style("display", "block").attr("cx", this.width/2).attr("cy", this.height/2).attr("r", radius);
            this.proj3D.translate([this.width/2, this.height/2]).scale(radius).rotate(this.rotation);
            this.pathGen = d3.geoPath().projection(this.proj3D);
            this.g.attr("transform", null);
        } else {
            this.oceanSphere.style("display", "none");
            this.pathGen = d3.geoPath().projection(this.proj2D);
            if(this.features.length) this.proj2D.fitExtent([[margin, margin], [this.width-margin, this.height-margin]], {type:"FeatureCollection", features:this.features});
        }
        this.updatePaths();
    }

    updatePaths() {
        if(this.gBase) this.gBase.selectAll("path").attr("d", this.pathGen);
        if(this.gRivers && this.showWater) this.gRivers.selectAll("path").attr("d", this.pathGen);
        if(this.gLakes && this.showWater) this.gLakes.selectAll("path").attr("d", this.pathGen);
        this.renderDecorations();
    }

    updateViewMode() {
        const choroContainer = document.getElementById('choropleth-legend-container');
        const poliContainer = document.getElementById('political-legend-container');
        
        if (this.currentMode === 'political') {
            choroContainer.style.display = 'none'; poliContainer.style.display = 'flex';
            if (this.gBase) this.gBase.selectAll(".area").attr("fill", d => d.properties._c || APP_CONFIG.DEFAULT_LAND_HEX);
            this.renderDecorations(); return;
        }

        choroContainer.style.display = 'block'; poliContainer.style.display = 'none';
        const isPop = this.currentMode === 'population';
        const valFeats = this.features.filter(d => (d.properties._p || 0) > 0);
        let max = 1;
        if (valFeats.length > 0) max = d3.max(valFeats, d => isPop ? d.properties._p : (d.properties._p / d.properties._a));

        const inter = isPop ? d3.interpolateBlues : d3.interpolateYlOrRd;
        const scale = d3.scaleSequentialPow(inter).exponent(0.3).domain([0, max]);
        document.getElementById('choropleth-bar').style.background = `linear-gradient(to right, ${inter(0)}, ${inter(0.5)}, ${inter(1)})`;
        document.getElementById('choro-max').textContent = isPop ? (max/1000000).toFixed(1) + "M" : max.toFixed(0) + " ab/km²";

        if (this.gBase) {
            this.gBase.selectAll(".area").attr("fill", d => {
                const pop = d.properties._p || 0;
                return pop === 0 ? APP_CONFIG.DEFAULT_LAND_HEX : scale(isPop ? pop : pop/d.properties._a);
            });
        }
        this.renderDecorations();
    }

    renderDecorations() {
        if (!this.gLabels) return;
        this.gLabels.selectAll("*").remove();

        const transform = d3.zoomTransform(this.svg.node());
        const scale = this.is3D ? (this.proj3D.scale() / (Math.min(this.width, this.height)/2.8)) : transform.k;

        if (this.showLabels) {
            const labelData = []; const seen = new Set();
            this.features.forEach(d => {
                const grp = this.getGroupName(d);
                if (!seen.has(grp) && (d.properties._c !== APP_CONFIG.DEFAULT_LAND_HEX || d.properties._p > 0)) {
                    seen.add(grp);
                    const big = this.features.filter(f => this.getGroupName(f) === grp).reduce((m, f) => f.properties._a > m.properties._a ? f : m);
                    labelData.push(big);
                }
            });

            this.gLabels.selectAll(".map-label").data(labelData).enter().append("text").attr("class", "map-label")
                .attr("transform", d => {
                    const c = this.getBestCentroid(d);
                    if(this.is3D && !this.pathGen({type:"Point", coordinates:c})) return "translate(-9999,-9999)";
                    const p = this.pathGen.projection()(c); return p ? `translate(${p[0]},${p[1]})` : "";
                })
                .text(d => this.currentMode==='political' ? this.getGroupName(d) : (this.currentMode==='population' ? ((d.properties._p||0)/1000000).toFixed(1)+"M" : ((d.properties._p||0)/d.properties._a).toFixed(1)))
                .attr("font-size", `${12/scale}px`).attr("stroke-width", `${3/scale}px`);
        }

        this.gLabels.selectAll(".tactical-marker").data(this.tacticalMarkers).enter().append("text").attr("class", "tactical-marker")
            .attr("transform", d => {
                if(this.is3D && !this.pathGen({type:"Point", coordinates:[d.lon, d.lat]})) return "translate(-9999,-9999)";
                const p = this.pathGen.projection()([d.lon, d.lat]); return p ? `translate(${p[0]},${p[1]})` : "";
            })
            .text("📍").attr("font-size", `${26/scale}px`);
    }

    generatePoliticalLegend() {
        const list = document.getElementById('political-legend-list'); list.innerHTML = '';
        const facs = new Map();
        this.features.forEach(d => { if(d.properties._c && d.properties._c !== APP_CONFIG.DEFAULT_LAND_HEX && d.properties._f) facs.set(d.properties._c, d.properties._f); });
        document.getElementById('political-legend-count').textContent = facs.size;
        Array.from(facs.entries()).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([col, name]) => {
            const item = document.createElement('div'); item.className = 'poli-legend-item';
            item.innerHTML = `<div class="poli-color-box" style="background:${col};"></div><span style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>`;
            item.onclick = () => { this.currentColor = col; document.getElementById('colorPicker').value = col; document.getElementById('factionNameInput').value = name; };
            list.appendChild(item);
        });
    }

    execSearch(val) {
        const res = document.getElementById('searchResults'); res.innerHTML = '';
        if(val.length < 2) { res.style.display = 'none'; return; }
        const nats = new Set(); const regs = [];
        this.features.forEach(d => {
            const an = this.getAreaName(d).toLowerCase(); const nn = this.getNationName(d).toLowerCase();
            if (nn.includes(val)) nats.add(this.getNationName(d));
            if (an.includes(val) && an !== nn) regs.push({n: this.getAreaName(d), nat: this.getNationName(d), f: d});
        });
        
        let has = false;
        if(nats.size > 0) {
            has = true; res.innerHTML += `<div class="search-category">Nazioni</div>`;
            Array.from(nats).slice(0,5).forEach(n => {
                const div = document.createElement('div'); div.className = 'search-item'; div.innerHTML = `<b>${n}</b> <span>Colora Tutto</span>`;
                div.onclick = () => { this.colorAndZoom(n, true); document.getElementById('searchInput').value=''; res.style.display='none'; };
                res.appendChild(div);
            });
        }
        if(regs.length > 0) {
            has = true; res.innerHTML += `<div class="search-category">Regioni</div>`;
            const unq = []; const s = new Set();
            for(let r of regs) { if(!s.has(r.n)){ s.add(r.n); unq.push(r); } }
            unq.slice(0,10).forEach(r => {
                const div = document.createElement('div'); div.className = 'search-item'; div.innerHTML = `${r.n} <span>${r.nat}</span>`;
                div.onclick = () => { this.colorAndZoom(r.f, false); document.getElementById('searchInput').value=''; res.style.display='none'; };
                res.appendChild(div);
            });
        }
        res.style.display = has ? 'block' : 'none';
    }

    colorAndZoom(target, isNation) {
        const tName = document.getElementById('factionNameInput').value || "Gruppo";
        const cColor = this.currentColor;
        
        if(cColor !== APP_CONFIG.DEFAULT_LAND_HEX) this.features.forEach(f => { if(f.properties._c === cColor) f.properties._f = tName; });

        let targetGroup = isNation ? target : this.getGroupName(target);
        
        this.features.forEach((d, i) => {
            const match = isNation ? this.getNationName(d) === target : this.getGroupName(d) === targetGroup;
            if(match) {
                if(cColor === APP_CONFIG.DEFAULT_LAND_HEX) { d.properties._c = APP_CONFIG.DEFAULT_LAND_HEX; delete d.properties._f; }
                else { d.properties._c = cColor; d.properties._f = tName; }
                if(this.currentMode === 'political' && this.gBase) this.gBase.select(`#path-${i}`).attr("fill", d.properties._c);
            }
        });

        if (!isNation) {
            const d = target; this.selectedFeatureIndex = this.features.indexOf(d);
            document.getElementById('inspector-panel').style.display = 'block';
            document.getElementById('insp-name').textContent = this.getAreaName(d);
            document.getElementById('insp-admin').textContent = this.getNationName(d);
            document.getElementById('insp-area').textContent = d.properties._a.toLocaleString('it-IT', {maximumFractionDigits:0}) + " km²";
            document.getElementById('insp-pop').value = d.properties._p > 0 ? d.properties._p : "";
            document.getElementById('insp-density').textContent = (d.properties._p > 0 ? d.properties._p/d.properties._a : 0).toLocaleString('it-IT', {maximumFractionDigits:1});
        }

        this.generatePoliticalLegend(); if(this.currentMode !== 'political') this.updateViewMode();
        
        const matches = this.features.filter(d => isNation ? this.getNationName(d) === target : this.getGroupName(d) === targetGroup);
        if(matches.length && this.pathGen) {
            const big = matches.reduce((m,f)=>f.properties._a > m.properties._a ? f : m);
            if(!this.is3D) {
                const b = this.pathGen.bounds(big);
                const s = Math.max(1, Math.min(40, 0.8 / Math.max((b[1][0]-b[0][0])/this.width, (b[1][1]-b[0][1])/this.height)));
                this.svg.transition().duration(800).call(this.zoomBehavior.transform, d3.zoomIdentity.translate(this.width/2 - s*(b[0][0]+b[1][0])/2, this.height/2 - s*(b[0][1]+b[1][1])/2).scale(s));
            } else {
                d3.transition().duration(800).tween("rotate", () => {
                    const r = d3.interpolate(this.proj3D.rotate(), [-this.getBestCentroid(big)[0], -this.getBestCentroid(big)[1]]);
                    return t => { this.proj3D.rotate(r(t)); this.rotation = this.proj3D.rotate(); this.updatePaths(); };
                });
            }
        }
        this.renderDecorations(); this.pushState();
    }

    generateState() {
        const sd = {};
        this.features.forEach(d => { 
            if ((d.properties._c && d.properties._c !== APP_CONFIG.DEFAULT_LAND_HEX) || d.properties._p > 0) {
                sd[this.getAreaName(d)] = { c: d.properties._c, f: d.properties._f, p: d.properties._p };
            } 
        });
        return { mapType: this.currentMapType, data: sd, markers: this.tacticalMarkers };
    }

    applyState(state) {
        if (!state || !state.data) return;
        this.features.forEach((d,i) => {
            let s = state.data[this.getAreaName(d)] || state.data[i];
            if (s) { d.properties._c = s.c || APP_CONFIG.DEFAULT_LAND_HEX; d.properties._f = s.f; d.properties._p = s.p || 0; }
            else { d.properties._c = APP_CONFIG.DEFAULT_LAND_HEX; d.properties._p = 0; delete d.properties._f; }
        });
        this.tacticalMarkers = state.markers || [];
        this.generatePoliticalLegend(); this.updateViewMode(); this.renderDecorations();
    }

    pushState() {
        if (this.isApplyingState) return;
        if (this.historyIndex < this.history.length - 1) this.history = this.history.slice(0, this.historyIndex + 1);
        const st = JSON.stringify(this.generateState());
        if (this.historyIndex >= 0 && this.history[this.historyIndex] === st) return;
        this.history.push(st); this.historyIndex++;
        if (this.history.length > 30) { this.history.shift(); this.historyIndex--; }
    }
    undo() { if(this.historyIndex>0){ this.historyIndex--; this.isApplyingState=true; this.applyState(JSON.parse(this.history[this.historyIndex])); this.isApplyingState=false; showToast("↩️ Annullato"); } }
    redo() { if(this.historyIndex<this.history.length-1){ this.historyIndex++; this.isApplyingState=true; this.applyState(JSON.parse(this.history[this.historyIndex])); this.isApplyingState=false; showToast("↪️ Ripristinato"); } }
}