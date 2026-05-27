/* Caixa Breda Advocacia — App unificado (entradas/saidas)
   Espera-se que cada HTML defina antes:
     window.CAIXA_CONFIG = { aba: "entradas" | "saidas", titulo: "...", subtitulo: "..." }
*/
(function () {
  "use strict";

  const CFG = window.CAIXA_CONFIG || { aba: "entradas" };
  const LS_KEY_URL = "caixaBredaApiUrl";
  const LS_KEY_CACHE = `caixaBredaCache_${CFG.aba}`;

  const MESES_PT = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  const state = {
    dados: [],
    filtroAno: null,
    filtroMes: null,
    filtroCategoria: null,
    filtroBusca: "",
    apiUrl: localStorage.getItem(LS_KEY_URL) || "",
    chartEvolucao: null,
    chartCategorias: null,
  };

  // ----------------- HELPERS -----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const fmtBRL = (n) =>
    "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtData = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  const toast = (msg, isError = false) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("err", isError);
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2800);
  };

  // ----------------- API -----------------
  async function apiGet(params = {}) {
    if (!state.apiUrl) throw new Error("Configure a URL da API em ⚙ no topo.");
    const url = new URL(state.apiUrl);
    url.searchParams.set("aba", CFG.aba);
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    const r = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    const data = await r.json();
    if (!data.ok) throw new Error(data.erro || "Erro na API");
    return data;
  }

  async function apiPost(acao, lancamento) {
    if (!state.apiUrl) throw new Error("Configure a URL da API em ⚙ no topo.");
    const r = await fetch(state.apiUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight CORS
      body: JSON.stringify({ aba: CFG.aba, acao, lancamento }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.erro || "Erro na API");
    return data;
  }

  // ----------------- CARREGAMENTO -----------------
  async function carregar() {
    const loader = $("#loader");
    const tabela = $("#tabela-card");
    loader.style.display = "flex";
    tabela.style.display = "none";

    try {
      const res = await apiGet();
      state.dados = res.dados || [];
      localStorage.setItem(LS_KEY_CACHE, JSON.stringify({ ts: Date.now(), dados: state.dados }));
    } catch (err) {
      // Tentar cache
      const cache = localStorage.getItem(LS_KEY_CACHE);
      if (cache) {
        state.dados = JSON.parse(cache).dados || [];
        toast("API indisponível — exibindo cache offline.", true);
      } else {
        toast(err.message, true);
        state.dados = [];
      }
    } finally {
      loader.style.display = "none";
      tabela.style.display = "block";
      popularFiltros();
      render();
    }
  }

  // ----------------- FILTROS -----------------
  function aplicarFiltros() {
    let r = state.dados.slice();
    if (state.filtroAno) r = r.filter((x) => x.ano == state.filtroAno);
    if (state.filtroMes) r = r.filter((x) => x.mes == state.filtroMes);
    if (state.filtroCategoria) r = r.filter((x) => x.categoria === state.filtroCategoria);
    if (state.filtroBusca) {
      const q = state.filtroBusca.toLowerCase();
      r = r.filter((x) => (x.descricao || "").toLowerCase().includes(q));
    }
    return r;
  }

  function popularFiltros() {
    const anos = Array.from(new Set(state.dados.map((x) => x.ano).filter(Boolean))).sort((a, b) => b - a);
    const selAno = $("#filtro-ano");
    selAno.innerHTML = '<option value="">Todos os anos</option>' +
      anos.map((a) => `<option value="${a}">${a}</option>`).join("");

    const selMes = $("#filtro-mes");
    selMes.innerHTML = '<option value="">Todos os meses</option>' +
      MESES_PT.map((nome, i) => `<option value="${i + 1}">${nome}</option>`).join("");

    if (state.filtroAno) selAno.value = state.filtroAno;
    if (state.filtroMes) selMes.value = state.filtroMes;
  }

  // ----------------- RENDER -----------------
  function render() {
    const filtrados = aplicarFiltros();
    renderKPIs(filtrados);
    renderChips(filtrados);
    renderTabela(filtrados);
    renderGraficos(filtrados);
  }

  function renderKPIs(filtrados) {
    const totalPeriodo = filtrados.reduce((s, x) => s + (x.valor || 0), 0);
    $("#kpi-total").textContent = fmtBRL(totalPeriodo);
    $("#kpi-qtd").textContent = filtrados.length.toLocaleString("pt-BR");

    // Mês atual (do dispositivo) vs mês anterior
    const now = new Date();
    const yAtual = now.getFullYear();
    const mAtual = now.getMonth() + 1;
    const mAnt = mAtual === 1 ? 12 : mAtual - 1;
    const yAnt = mAtual === 1 ? yAtual - 1 : yAtual;

    const totMesAtual = state.dados
      .filter((x) => x.ano === yAtual && x.mes === mAtual)
      .reduce((s, x) => s + (x.valor || 0), 0);
    const totMesAnt = state.dados
      .filter((x) => x.ano === yAnt && x.mes === mAnt)
      .reduce((s, x) => s + (x.valor || 0), 0);

    $("#kpi-mes").textContent = fmtBRL(totMesAtual);
    const sub = $("#kpi-mes-sub");
    if (totMesAnt > 0) {
      const diff = ((totMesAtual - totMesAnt) / totMesAnt) * 100;
      const sign = diff >= 0 ? "↑" : "↓";
      sub.textContent = `${sign} ${Math.abs(diff).toFixed(1)}% vs ${MESES_PT[mAnt - 1]}`;
      sub.className = "kpi-sub " + (diff >= 0 ? "pos" : "neg");
    } else {
      sub.textContent = "sem comparativo";
      sub.className = "kpi-sub";
    }

    const totAno = state.dados
      .filter((x) => x.ano === yAtual)
      .reduce((s, x) => s + (x.valor || 0), 0);
    $("#kpi-ano").textContent = fmtBRL(totAno);
  }

  function renderChips(filtrados) {
    const cats = Array.from(new Set(state.dados.map((x) => x.categoria))).sort();
    const wrap = $("#chips");
    wrap.innerHTML = cats
      .map(
        (c) =>
          `<button class="chip ${state.filtroCategoria === c ? "active" : ""}" data-cat="${c}">${c}</button>`
      )
      .join("");
    $$(".chip", wrap).forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filtroCategoria = state.filtroCategoria === btn.dataset.cat ? null : btn.dataset.cat;
        render();
      });
    });
  }

  function renderTabela(filtrados) {
    const ordenados = filtrados.slice().sort((a, b) => {
      const da = a.data || "0";
      const db = b.data || "0";
      return db.localeCompare(da);
    });
    const tbody = $("#tabela-body");
    if (ordenados.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4">
        <div class="empty-state">
          <h3>Sem lançamentos</h3>
          <p>Ajuste os filtros ou adicione um novo lançamento clicando em "+ NOVO".</p>
        </div>
      </td></tr>`;
    } else {
      tbody.innerHTML = ordenados
        .map(
          (x) => `
        <tr data-id="${x.id}">
          <td class="col-data">${fmtData(x.data)}</td>
          <td class="col-desc">${escapeHtml(x.descricao)}</td>
          <td class="col-cat"><span class="pill">${escapeHtml(x.categoria || "—")}</span></td>
          <td class="col-valor">${fmtBRL(x.valor)}</td>
        </tr>`
        )
        .join("");
      $$("#tabela-body tr").forEach((tr) => {
        tr.addEventListener("click", () => abrirModalEdicao(tr.dataset.id));
      });
    }
    $("#tabela-meta").textContent = `${ordenados.length} lançamento${ordenados.length === 1 ? "" : "s"} · ${fmtBRL(
      ordenados.reduce((s, x) => s + (x.valor || 0), 0)
    )}`;
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ----------------- GRÁFICOS -----------------
  function renderGraficos(filtrados) {
    if (typeof Chart === "undefined") return;

    // Evolução mensal (últimos 12 meses dos filtrados ou do total)
    const base = filtrados.length > 0 ? filtrados : state.dados;
    const buckets = {};
    base.forEach((x) => {
      if (!x.ano || !x.mes) return;
      const k = `${x.ano}-${String(x.mes).padStart(2, "0")}`;
      buckets[k] = (buckets[k] || 0) + (x.valor || 0);
    });
    const keys = Object.keys(buckets).sort().slice(-12);
    const labels = keys.map((k) => {
      const [y, m] = k.split("-");
      return `${MESES_PT[parseInt(m, 10) - 1].slice(0, 3)}/${y.slice(2)}`;
    });
    const values = keys.map((k) => buckets[k]);

    const ctx1 = $("#chart-evolucao").getContext("2d");
    if (state.chartEvolucao) state.chartEvolucao.destroy();
    state.chartEvolucao = new Chart(ctx1, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: "rgba(30, 58, 95, 0.85)",
            borderColor: "#c9a961",
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            ticks: {
              callback: (v) => "R$ " + (v / 1000).toFixed(0) + "k",
              font: { size: 10 },
              color: "#5a6573",
            },
            grid: { color: "#f0eee9" },
          },
          x: { ticks: { font: { size: 10 }, color: "#5a6573" }, grid: { display: false } },
        },
      },
    });

    // Categorias (donut)
    const catBuckets = {};
    base.forEach((x) => {
      catBuckets[x.categoria || "—"] = (catBuckets[x.categoria || "—"] || 0) + (x.valor || 0);
    });
    const catLabels = Object.keys(catBuckets);
    const catValues = catLabels.map((c) => catBuckets[c]);
    const palette = ["#0a2540", "#c9a961", "#2d4e75", "#b89548", "#1e3a5f", "#8b3a3a", "#2e7d4f", "#8a929c", "#5a6573", "#b8860b"];

    const ctx2 = $("#chart-categorias").getContext("2d");
    if (state.chartCategorias) state.chartCategorias.destroy();
    state.chartCategorias = new Chart(ctx2, {
      type: "doughnut",
      data: {
        labels: catLabels,
        datasets: [
          {
            data: catValues,
            backgroundColor: catLabels.map((_, i) => palette[i % palette.length]),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: {
            position: "right",
            labels: { font: { size: 10 }, color: "#5a6573", boxWidth: 10 },
          },
        },
      },
    });
  }

  // ----------------- MODAL -----------------
  function abrirModalNovo() {
    $("#modal-titulo").textContent = "Novo lançamento";
    $("#modal-form").reset();
    $("#modal-id").value = "";
    $("#modal-data").value = new Date().toISOString().slice(0, 10);
    popularSelectCategorias();
    $("#btn-deletar").style.display = "none";
    $("#modal").classList.add("open");
  }

  function abrirModalEdicao(id) {
    const x = state.dados.find((d) => d.id === id);
    if (!x) return;
    $("#modal-titulo").textContent = "Editar lançamento";
    popularSelectCategorias();
    $("#modal-id").value = x.id;
    $("#modal-data").value = x.data || "";
    $("#modal-desc").value = x.descricao || "";
    $("#modal-valor").value = x.valor || "";
    $("#modal-cat").value = x.categoria || "";
    $("#btn-deletar").style.display = "inline-block";
    $("#modal").classList.add("open");
  }

  function popularSelectCategorias() {
    const cats = Array.from(new Set(state.dados.map((x) => x.categoria))).sort();
    const padroes = CFG.aba === "entradas"
      ? ["Honorários", "Sucumbência", "Reembolsos", "Rendas / Aplicações", "Outros Recebimentos"]
      : ["Despesas Fixas", "Folha (Salários)", "Impostos", "Contabilidade", "Despesas Viagens", "Despesas Carros", "Despesas Diversas", "Custas / Notificações", "Tarifas Bancárias", "Investimentos", "Retiradas (Pró-labore)", "Terreno CBA"];
    const todas = Array.from(new Set([...padroes, ...cats])).sort();
    $("#modal-cat").innerHTML = todas.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
  }

  function fecharModal() { $("#modal").classList.remove("open"); }

  async function salvarLancamento(ev) {
    ev.preventDefault();
    const id = $("#modal-id").value;
    const lanc = {
      data: $("#modal-data").value,
      descricao: $("#modal-desc").value.trim(),
      valor: parseFloat($("#modal-valor").value),
      categoria: $("#modal-cat").value,
    };
    if (!lanc.data || !lanc.descricao || isNaN(lanc.valor)) {
      toast("Preencha data, descrição e valor.", true);
      return;
    }
    try {
      if (id) {
        lanc.id = id;
        const r = await apiPost("editar", lanc);
        const idx = state.dados.findIndex((x) => x.id === id);
        if (idx >= 0) state.dados[idx] = r.lancamento;
        toast("Lançamento atualizado.");
      } else {
        const r = await apiPost("criar", lanc);
        state.dados.push(r.lancamento);
        toast("Lançamento criado.");
      }
      fecharModal();
      localStorage.setItem(LS_KEY_CACHE, JSON.stringify({ ts: Date.now(), dados: state.dados }));
      popularFiltros();
      render();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function deletarLancamento() {
    const id = $("#modal-id").value;
    if (!id) return;
    if (!confirm("Excluir este lançamento? Não dá pra desfazer.")) return;
    try {
      await apiPost("deletar", { id });
      state.dados = state.dados.filter((x) => x.id !== id);
      toast("Lançamento removido.");
      fecharModal();
      localStorage.setItem(LS_KEY_CACHE, JSON.stringify({ ts: Date.now(), dados: state.dados }));
      render();
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ----------------- DRAWER CONFIG -----------------
  function abrirDrawer() {
    $("#drawer-url").value = state.apiUrl;
    $("#drawer").classList.add("open");
    $("#drawer-backdrop").classList.add("open");
  }
  function fecharDrawer() {
    $("#drawer").classList.remove("open");
    $("#drawer-backdrop").classList.remove("open");
  }
  function salvarConfig() {
    const url = $("#drawer-url").value.trim();
    state.apiUrl = url;
    localStorage.setItem(LS_KEY_URL, url);
    toast("URL salva. Recarregando dados…");
    fecharDrawer();
    carregar();
  }

  // ----------------- INIT -----------------
  function bindEvents() {
    $("#filtro-ano").addEventListener("change", (e) => { state.filtroAno = e.target.value || null; render(); });
    $("#filtro-mes").addEventListener("change", (e) => { state.filtroMes = e.target.value || null; render(); });
    $("#filtro-busca").addEventListener("input", (e) => { state.filtroBusca = e.target.value; render(); });
    $("#btn-limpar").addEventListener("click", () => {
      state.filtroAno = null;
      state.filtroMes = null;
      state.filtroCategoria = null;
      state.filtroBusca = "";
      $("#filtro-ano").value = "";
      $("#filtro-mes").value = "";
      $("#filtro-busca").value = "";
      render();
    });

    $("#fab-novo").addEventListener("click", abrirModalNovo);
    $("#btn-fechar-modal").addEventListener("click", fecharModal);
    $("#btn-cancelar").addEventListener("click", fecharModal);
    $("#btn-deletar").addEventListener("click", deletarLancamento);
    $("#modal-form").addEventListener("submit", salvarLancamento);
    $("#modal").addEventListener("click", (e) => {
      if (e.target.id === "modal") fecharModal();
    });

    $("#btn-config").addEventListener("click", abrirDrawer);
    $("#btn-fechar-drawer").addEventListener("click", fecharDrawer);
    $("#drawer-backdrop").addEventListener("click", fecharDrawer);
    $("#btn-salvar-config").addEventListener("click", salvarConfig);
    $("#btn-recarregar").addEventListener("click", carregar);

    $("#btn-exportar").addEventListener("click", exportarCSV);
  }

  function exportarCSV() {
    const filtrados = aplicarFiltros();
    if (filtrados.length === 0) { toast("Nada para exportar.", true); return; }
    const cols = ["data", "descricao", "valor", "categoria", "ano", "mes"];
    const head = cols.join(";");
    const rows = filtrados.map((x) => cols.map((c) => {
      const v = x[c] == null ? "" : String(x[c]).replace(/"/g, '""');
      return /[;\n"]/.test(v) ? `"${v}"` : v;
    }).join(";"));
    const blob = new Blob(["﻿" + head + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `caixa-${CFG.aba}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Aplicar título/subtítulo conforme app
    if (CFG.titulo) document.title = CFG.titulo + " · Breda Advocacia";
    $("#app-titulo-principal").textContent = CFG.titulo || "Caixa";
    $("#app-titulo-sub").textContent = CFG.subtitulo || "";

    if (!state.apiUrl) {
      // Sem URL → abrir drawer pra configurar
      abrirDrawer();
      $("#loader").style.display = "none";
      $("#tabela-card").style.display = "block";
      $("#tabela-body").innerHTML = `<tr><td colspan="4">
        <div class="empty-state">
          <h3>Configure o backend</h3>
          <p>Cole a URL do Web App do Google Apps Script no campo à direita para começar.</p>
        </div>
      </td></tr>`;
      return;
    }
    bindEvents();
    carregar();

    // PWA service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./assets/sw.js").catch(() => {});
    }
  });

  // Garantir bind mesmo no caminho sem-URL acima
  document.addEventListener("DOMContentLoaded", () => setTimeout(bindEvents, 0));
})();
