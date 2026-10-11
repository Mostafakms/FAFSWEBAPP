import {
  IconActivity,
  IconArrowDownRight,
  IconArrowUpRight,
  IconBell,
  IconBuilding,
  IconChartBar,
  IconCheck,
  IconChevronLeft,
  IconClock,
  IconDownload,
  IconFlame,
  IconMaximize,
  IconHandMove,
  IconLayoutDashboard,
  IconMap2,
  IconMinus,
  IconMinimize,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { signOut } from "@agent-native/core/client";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";
import * as AlertDialog from "@/components/ui/alert-dialog";

const navItems = [
  { id: "dashboard", label: "Overview", icon: IconLayoutDashboard },
  { id: "map", label: "Site map", icon: IconMap2 },
  { id: "buildings", label: "Buildings & facilities", icon: IconBuilding },
  { id: "reports", label: "Reports", icon: IconChartBar },
  { id: "history", label: "Change history", icon: IconClock },
  { id: "settings", label: "Settings", icon: IconSettings },
] as const;

type View = (typeof navItems)[number]["id"] | "detail";
type BuildingDraft = { id?: string; number: string; name: string; weight: string; manualStatus: "Auto" | "Delayed" | "On Hold" | "Removed from Scope"; statusReason: string };
type ActivityDraft = { id?: string; name: string; weight: number; sortOrder: number; enabled: boolean };
type StatusFilter = "All" | "Not Started" | "In Progress" | "Completed" | "Delayed" | "On Hold" | "Removed from Scope";

const statusLabels: Record<string, string> = {
  "Not Started": "Not Started",
  "In Progress": "In Progress",
  Completed: "Completed",
  Delayed: "Delayed",
  "On Hold": "On Hold",
  "Removed from Scope": "Removed from scope",
};

const statusClass: Record<string, string> = {
  "Not Started": "status-not-started",
  "In Progress": "status-in-progress",
  Completed: "status-completed",
  Delayed: "status-delayed",
  "On Hold": "status-on-hold",
  "Removed from Scope": "status-removed-from-scope",
};
const MAX_MAP_ZOOM = 8;
const APRC_MAP_IMAGE = "https://cdn.builder.io/api/v1/image/assets%2F89b6b72eb65a44cdad78d1af466d297d%2Fb9a198683ea34fa881c3ca8e554d06b0?format=webp&width=800&height=1200";
const MAP_IMAGE_STORAGE_KEY = "fafs-site-map-image";
const MAX_MAP_IMAGE_BYTES = 15 * 1024 * 1024;
const MAP_POLYGON_STROKE_WIDTH = 0.9;
const MAP_DRAFT_STROKE_WIDTH = 0.7;
const MAP_POINT_RADIUS = 0.6;
const MAP_LABEL_FONT_SIZE = 1.82;
type StoredMapImage = { file: Blob; name: string };

function requestMapImageStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const opening = window.indexedDB.open("fafs-map-assets", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("images");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      try {
        const transaction = database.transaction("images", mode);
        const request = action(transaction.objectStore("images"));
        let result: T;
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => transaction.abort();
        transaction.oncomplete = () => { database.close(); resolve(result); };
        transaction.onerror = () => { database.close(); reject(transaction.error ?? request.error); };
        transaction.onabort = () => { database.close(); reject(transaction.error ?? request.error); };
      } catch (error) {
        database.close();
        reject(error);
      }
    };
  });
}

export function meta() {
  return [
    { title: APP_TITLE },
    { name: "description", content: "Fire alarm system progress tracking — Amreya Petroleum Refining Company" },
  ];
}

export default function HomeRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error } = useActionQuery("get-project-data", { historyLimit: 50 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [buildingFormOpen, setBuildingFormOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [buildingDraft, setBuildingDraft] = useState<BuildingDraft>({ number: "", name: "", weight: "1", manualStatus: "Auto", statusReason: "" });
  const [activityDraft, setActivityDraft] = useState<ActivityDraft[]>([]);
  const [projectDraft, setProjectDraft] = useState({ name: "", description: "", startDate: "", plannedCompletionDate: "", status: "In Progress" as "In Progress" | "On Hold" | "Completed" });
  const [progressDraft, setProgressDraft] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState<[number, number]>([0, 0]);
  const [isPanMode, setIsPanMode] = useState(true);
  const [mapBuildingId, setMapBuildingId] = useState("");
  const [mapDrawing, setMapDrawing] = useState(false);
  const [mapPolygonDraft, setMapPolygonDraft] = useState<[number, number][]>([]);
  const progressMutation = useActionMutation("update-activity-progress", {
    onSuccess: () => setNotice("Progress saved and recorded in the audit history."),
  });
  const buildingMutation = useActionMutation("save-building", {
    onSuccess: () => {
      setBuildingFormOpen(false);
      setBuildingDraft({ number: "", name: "", weight: "1", manualStatus: "Auto", statusReason: "" });
      setNotice("Facility details saved.");
    },
  });
  const deleteBuildingMutation = useActionMutation("delete-building", {
    onSuccess: () => {
      setBuildingFormOpen(false);
      setDeleteDialogOpen(false);
      setBuildingDraft({ number: "", name: "", weight: "1", manualStatus: "Auto", statusReason: "" });
      setNotice("Facility and its saved progress history deleted.");
    },
  });
  const mapPolygonMutation = useActionMutation("save-building", {
    onSuccess: () => {
      setMapDrawing(false);
      setMapPolygonDraft([]);
      setNotice("Facility boundary saved to the site map.");
    },
  });
  const settingsMutation = useActionMutation("save-project-settings", {
    onSuccess: () => setNotice("Project settings and activity weights saved."),
  });

  useEffect(() => {
    if (!data) return;
    setActivityDraft(data.activities.map((activity) => ({
      id: activity.id,
      name: activity.name,
      weight: activity.weight,
      sortOrder: activity.sortOrder,
      enabled: activity.enabled,
    })));
    setProjectDraft({
      name: data.project.name,
      description: data.project.description,
      startDate: data.project.startDate,
      plannedCompletionDate: data.project.plannedCompletionDate,
      status: data.project.status as "In Progress" | "On Hold" | "Completed",
    });
  }, [data]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const view = (searchParams.get("view") ?? "dashboard") as View;
  const selectedBuildingId = searchParams.get("buildingId");
  const selectedBuilding = data?.buildings.find((building) => building.id === selectedBuildingId);
  const filteredBuildings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.buildings ?? []).filter((building) => {
      const matchesSearch = !query || `${building.number} ${building.name}`.toLowerCase().includes(query);
      const matchesStatus = statusFilter === "All" || building.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [data?.buildings, search, statusFilter]);
  const activeWeightTotal = activityDraft.filter((activity) => activity.enabled)
    .reduce((sum, activity) => sum + Number(activity.weight || 0), 0);

  function openView(nextView: View, buildingId?: string) {
    const next = new URLSearchParams();
    next.set("view", nextView);
    if (buildingId) next.set("buildingId", buildingId);
    setSearchParams(next);
    setNotice("");
  }

  function editBuilding(building: any) {
    setBuildingDraft({
      id: building.id,
      number: building.number,
      name: building.name,
      weight: String(building.weight),
      manualStatus: building.manualStatus as BuildingDraft["manualStatus"],
      statusReason: building.statusReason ?? "",
    });
    setBuildingFormOpen(true);
    openView("buildings");
  }

  function saveBuilding(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    buildingMutation.mutate({
      ...(buildingDraft.id ? { id: buildingDraft.id } : {}),
      number: buildingDraft.number,
      name: buildingDraft.name,
      weight: Number(buildingDraft.weight),
      manualStatus: buildingDraft.manualStatus,
      statusReason: buildingDraft.statusReason,
    });
  }

  function saveProgress(buildingId: string, activityId: string, currentProgress: number) {
    const input = progressDraft[activityId];
    const value = input === undefined ? currentProgress : Number(input);
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    progressMutation.mutate({ buildingId, activityId, progress: value });
    setProgressDraft((previous) => ({ ...previous, [activityId]: String(value) }));
  }

  function exportBuildings() {
    const rows = filteredBuildings.map((building, index) => [
      index + 1,
      building.number,
      building.name,
      building.weight,
      building.relativeWeight.toFixed(2),
      building.overallProgress.toFixed(2),
      statusLabels[building.status] ?? building.status,
      building.statusReason ?? "",
      building.updatedAt,
    ]);
    downloadCsv("fafs-buildings.csv", ["SN", "Building Number", "Building Name", "Weight", "Relative Weight %", "Overall Progress %", "Status", "Status Reason", "Last Update"], rows);
  }

  function exportActivityProgress() {
    const activityColumns = (data?.activities ?? []).filter((activity) => activity.enabled);
    const rows = (data?.buildings ?? []).map((building) => {
      const progressByActivityId = new Map(building.activities.map((activity) => [activity.id, activity.progress]));
      return [building.number, building.name, ...activityColumns.map((activity) => progressByActivityId.get(activity.id) ?? 0)];
    });
    downloadCsv("fafs-activity-progress.csv", ["Building Number", "Building Name", ...activityColumns.map((activity) => activity.name)], rows);
  }

  function exportHistory() {
    const rows = (data?.history ?? []).map((entry) => [
      entry.actorEmail,
      entry.createdAt,
      entry.buildingNumber,
      entry.buildingName,
      entry.activityName,
      entry.oldValue,
      entry.newValue,
    ]);
    downloadCsv("fafs-progress-history.csv", ["User", "Date", "Building Number", "Building Name", "Activity", "Old Progress %", "New Progress %"], rows);
  }

  const project = data?.project;
  const buildings = data?.buildings ?? [];
  const counts = data?.statusCounts ?? {};
  const delayedCount = (counts.Delayed ?? 0) + (counts["On Hold"] ?? 0);
  const buildingUpdates = buildings.map((building) => building.updatedAt).filter(Boolean).sort();
  const lastUpdate = buildingUpdates[buildingUpdates.length - 1];

  return (
    <div dir="ltr" className="fafs-shell">
      <aside className="fafs-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><IconFlame size={21} stroke={1.8} /></div>
          <div className="min-w-0">
            <div className="brand-name">FAFS <span>CONTROL</span></div>
            <div className="brand-site">Amreya Petroleum Refining Company</div>
          </div>
        </div>
        <div className="sidebar-project-label">PROJECT WORKSPACE</div>
        <div className="project-mini-card">
          <span className="project-mini-icon"><IconShieldCheck size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="project-mini-title">{project?.name ?? "Fire Alarm System"}</span>
            <span className="project-mini-meta">AMREYA · EGYPT</span>
          </span>
          <span className="live-dot" title="Project status" />
        </div>
        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id || (view === "detail" && item.id === "buildings");
            return (
              <button key={item.id} type="button" className={`nav-link ${active ? "is-active" : ""}`} onClick={() => openView(item.id)}>
                <Icon size={18} stroke={1.8} />
                <span>{item.label}</span>
                {item.id === "buildings" && buildings.length > 0 && <span className="nav-count">{buildings.length}</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-attribution">
            <img
              className="petromaint-logo"
              src="https://cdn.builder.io/api/v1/image/assets%2F89b6b72eb65a44cdad78d1af466d297d%2F3ad4edb5f82d4983afc75f43bf49cd54?format=webp&width=800&height=1200"
              alt="Petromaint"
            />
            <div className="designer-credit">Designed by Eng. Mostafa Nasser</div>
            <div className="designer-role">Site Manager</div>
          </div>
          <button type="button" className="user-card" onClick={() => signOut()} aria-label="Sign out">
            <span className="user-avatar">U</span>
            <span className="min-w-0 flex-1 text-left">
              <span className="user-name">Signed in</span>
              <span className="user-role">Sign out</span>
            </span>
            <IconArrowDownRight size={16} />
          </button>
        </div>
      </aside>

      <main className="fafs-main">
        <header className="topbar">
          <div className="topbar-context">
            <span className="breadcrumb-root">Fire alarm project</span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">{navItems.find((item) => item.id === view)?.label ?? (view === "detail" ? "Facility details" : "Overview")}</span>
          </div>
          <div className="topbar-actions">
            <span className="system-status"><span /> System operational</span>
            <button type="button" className="icon-button" aria-label="Notifications" title="Notifications — ready for future activation"><IconBell size={18} /></button>
            <span className="topbar-date">Last update {lastUpdate ? formatDate(lastUpdate) : "—"}</span>
          </div>
        </header>

        {notice && <div role="status" className="notice-banner"><IconCheck size={17} />{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice("")}><IconX size={15} /></button></div>}
        {error && <div role="alert" className="error-banner">Unable to load project data. Reload the page or check the database connection.</div>}
        {isLoading ? <LoadingSurface /> : view === "detail" && selectedBuilding ? (
          <BuildingDetails
            building={selectedBuilding}
            onBack={() => openView("buildings")}
            onEdit={() => editBuilding(selectedBuilding)}
            progressDraft={progressDraft}
            setProgressDraft={setProgressDraft}
            onSaveProgress={saveProgress}
            isSaving={progressMutation.isPending}
            error={progressMutation.error}
          />
        ) : view === "settings" ? (
          <SettingsView
            projectDraft={projectDraft}
            setProjectDraft={setProjectDraft}
            activityDraft={activityDraft}
            setActivityDraft={setActivityDraft}
            activeWeightTotal={activeWeightTotal}
            isSaving={settingsMutation.isPending}
            error={settingsMutation.error}
            onSave={() => settingsMutation.mutate({ ...projectDraft, activities: activityDraft })}
          />
        ) : view === "buildings" ? (
          <BuildingsView
            buildings={filteredBuildings}
            allCount={buildings.length}
            search={search}
            setSearch={setSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onSelect={(id: string) => openView("detail", id)}
            onExport={exportBuildings}
            formOpen={buildingFormOpen}
            setFormOpen={setBuildingFormOpen}
            draft={buildingDraft}
            setDraft={setBuildingDraft}
            onSubmit={saveBuilding}
            isSaving={buildingMutation.isPending}
            error={buildingMutation.error ?? deleteBuildingMutation.error}
            onDelete={(id: string) => deleteBuildingMutation.mutate({ id })}
            isDeleting={deleteBuildingMutation.isPending}
            deleteDialogOpen={deleteDialogOpen}
            setDeleteDialogOpen={setDeleteDialogOpen}
          />
        ) : view === "map" ? (
          <SiteMapView
            buildings={buildings}
            zoom={mapZoom}
            setZoom={setMapZoom}
            pan={mapPan}
            setPan={setMapPan}
            isPanMode={isPanMode}
            setIsPanMode={setIsPanMode}
            selectedBuildingId={mapBuildingId}
            setSelectedBuildingId={setMapBuildingId}
            isDrawing={mapDrawing}
            setIsDrawing={setMapDrawing}
            polygonDraft={mapPolygonDraft}
            setPolygonDraft={setMapPolygonDraft}
            isSaving={mapPolygonMutation.isPending}
            onSavePolygon={(building: any, points: [number, number][]) => mapPolygonMutation.mutate({
              id: building.id,
              number: building.number,
              name: building.name,
              weight: building.weight,
              manualStatus: building.manualStatus,
              mapPolygon: points,
            })}
            onSelect={setMapBuildingId}
            onOpenDetails={(id: string) => openView("detail", id)}
          />
        ) : view === "reports" ? (
          <ReportsView data={data} onExportBuildings={exportBuildings} onExportActivityProgress={exportActivityProgress} onExportHistory={exportHistory} />
        ) : view === "history" ? (
          <HistoryView history={data?.history ?? []} onExport={exportHistory} />
        ) : (
          <DashboardView
            data={data}
            overallProgress={data?.overallProgress ?? 0}
            delayedCount={delayedCount}
            onBuildings={() => openView("buildings")}
            onSelect={(id: string) => openView("detail", id)}
            onMap={() => openView("map")}
          />
        )}
      </main>
    </div>
  );
}

function DashboardView({ data, overallProgress, delayedCount, onBuildings, onSelect, onMap }: {
  data: any;
  overallProgress: number;
  delayedCount: number;
  onBuildings: () => void;
  onSelect: (id: string) => void;
  onMap: () => void;
}) {
  const buildings = data?.buildings ?? [];
  const sorted = [...buildings].sort((a, b) => b.overallProgress - a.overallProgress);
  const topBuildings = sorted.slice(0, 3);
  const lowBuildings = [...buildings].sort((a, b) => a.overallProgress - b.overallProgress).slice(0, 3);
  return (
    <div className="page-content">
      <section className="welcome-row">
        <div>
          <div className="section-kicker"><span className="kicker-square" /> SYSTEM IMPLEMENTATION</div>
          <h1>{data?.project.name ?? "Fire Alarm System"}</h1>
          <p className="welcome-description">Project progress weighted by facility and activity weights.</p>
        </div>
        <button type="button" className="button-primary" onClick={onBuildings}><IconPlus size={17} /> Add facility</button>
      </section>

      <section className="kpi-grid" aria-label="Project metrics">
        <div className="kpi-card kpi-main">
          <div className="kpi-label">Overall project progress <span className="kpi-icon"><IconActivity size={17} /></span></div>
          <div className="kpi-value-row"><strong className="kpi-value">{formatPercent(overallProgress)}<span>%</span></strong><span className="kpi-caption">Weighted progress</span></div>
          <div className="progress-track progress-track-large"><span style={{ width: `${Math.min(overallProgress, 100)}%` }} /></div>
          <div className="kpi-footnote">Of total registered facility weights</div>
        </div>
        <KpiCard label="Total facilities" value={buildings.length} detail="Registered facilities" icon={<IconBuilding size={17} />} tone="blue" />
        <KpiCard label="Completed" value={data?.statusCounts?.Completed ?? 0} detail="100% complete" icon={<IconCheck size={17} />} tone="green" />
        <KpiCard label="In progress" value={data?.statusCounts?.["In Progress"] ?? 0} detail="Progress recorded" icon={<IconActivity size={17} />} tone="amber" />
        <KpiCard label="Not started" value={data?.statusCounts?.["Not Started"] ?? 0} detail="Work not started" icon={<IconClock size={17} />} tone="slate" />
        <KpiCard label="Delayed / on hold" value={delayedCount} detail="Needs attention" icon={<IconArrowDownRight size={17} />} tone="red" />
      </section>

      <section className="dashboard-grid">
        <div className="panel activity-panel">
          <div className="panel-heading">
            <div><h2>Progress by activity</h2><span>Average progress across registered facilities</span></div>
            <span className="panel-unit">WEIGHT · PROGRESS</span>
          </div>
          {data?.activityProgress?.length ? <div className="activity-chart-list">
            {data.activityProgress.map((activity: any) => (
              <div key={activity.id} className="activity-chart-row">
                <span className="activity-chart-name" title={activity.name}>{activity.name}</span>
                <div className="activity-chart-track"><span style={{ width: `${Math.min(activity.averageProgress, 100)}%` }} /></div>
                <span className="activity-chart-weight">{formatPercent(activity.weight)}%</span>
                <strong className="activity-chart-progress">{formatPercent(activity.averageProgress)}%</strong>
              </div>
            ))}
          </div> : <EmptyInline title="No activities to display" detail="Activities will appear here when configured." />}
          <div className="chart-legend"><span><i className="legend-line" /> Average progress</span><span>Calculated from project database records</span></div>
        </div>
        <div className="panel status-panel">
          <div className="panel-heading">
            <div><h2>Facility status</h2><span>Current distribution</span></div>
            <button type="button" className="subtle-link" onClick={onBuildings}>View all <IconChevronLeft size={15} /></button>
          </div>
          {buildings.length ? <>
            <div className="status-bar" aria-label="Facility status distribution">
              {(["Completed", "In Progress", "Delayed", "On Hold", "Not Started", "Removed from Scope"] as const).map((status) => {
                const count = data?.statusCounts?.[status] ?? 0;
                return count ? <span key={status} className={`status-segment ${statusClass[status]}`} style={{ width: `${(count / buildings.length) * 100}%` }} title={`${statusLabels[status]}: ${count}`} /> : null;
              })}
            </div>
            <div className="status-legend">
              {["Completed", "In Progress", "Delayed", "Not Started", "Removed from Scope"].map((status) => <div key={status}><span className={`status-dot ${statusClass[status]}`} /><span>{statusLabels[status]}</span><strong>{data?.statusCounts?.[status] ?? 0}</strong></div>)}
            </div>
          </> : <EmptyInline title="Waiting for facility data" detail="Status distribution appears after facilities are added or imported." />}
          <button type="button" className="map-teaser" onClick={onMap}>
            <span className="map-teaser-icon"><IconMap2 size={18} /></span>
            <span><strong>Interactive site map</strong><small>Explore facilities by status</small></span>
            <IconChevronLeft size={16} />
          </button>
        </div>
      </section>

      <section className="dashboard-grid lower-grid">
        <BuildingRankPanel title="Top performing facilities" icon={<IconArrowUpRight size={16} />} rows={topBuildings} empty="Facilities are ranked when project data is available." onSelect={onSelect} />
        <BuildingRankPanel title="Lowest performing facilities" icon={<IconArrowDownRight size={16} />} rows={lowBuildings} empty="Facilities are ranked when project data is available." onSelect={onSelect} />
      </section>
      <div className="data-provenance"><IconShieldCheck size={15} /> Only recorded project data is shown. The Excel file and site plan have not been provided yet.</div>
    </div>
  );
}

function KpiCard({ label, value, detail, icon, tone }: { label: string; value: number; detail: string; icon: React.ReactNode; tone: string }) {
  return <div className="kpi-card"><div className="kpi-label">{label}<span className={`kpi-icon ${tone}`}>{icon}</span></div><div className="kpi-value-row"><strong className="kpi-value">{value}</strong><span className="kpi-caption">{detail}</span></div></div>;
}

function BuildingRankPanel({ title, icon, rows, empty, onSelect }: { title: string; icon: React.ReactNode; rows: any[]; empty: string; onSelect: (id: string) => void }) {
  return <div className="panel rank-panel">
    <div className="panel-heading"><div><h2>{title} <span className="rank-heading-icon">{icon}</span></h2><span>Ranked by weighted progress</span></div></div>
    {rows.length ? <div className="rank-list">{rows.map((building, index) => <button key={building.id} type="button" className="rank-row" onClick={() => onSelect(building.id)}>
      <span className="rank-index">{String(index + 1).padStart(2, "0")}</span><span className="rank-building"><strong>{building.name}</strong><small>{building.number} · Weight {formatPercent(building.weight)}</small></span>
      <span className="rank-progress"><span className="progress-track"><i style={{ width: `${Math.min(building.overallProgress, 100)}%` }} /></span><strong>{formatPercent(building.overallProgress)}%</strong></span>
    </button>)}</div> : <EmptyInline title="No ranking data yet" detail={empty} />}
  </div>;
}

function BuildingsView({ buildings, allCount, search, setSearch, statusFilter, setStatusFilter, onSelect, onExport, formOpen, setFormOpen, draft, setDraft, onSubmit, isSaving, error, onDelete, isDeleting, deleteDialogOpen, setDeleteDialogOpen }: any) {
  return <div className="page-content">
    <section className="page-heading-row"><div><div className="section-kicker"><span className="kicker-square" /> ASSET REGISTER</div><h1>Buildings &amp; facilities</h1></div><div className="heading-actions"><button type="button" className="button-secondary" onClick={onExport}><IconDownload size={16} /> Export CSV</button><button type="button" className="button-primary" onClick={() => { setDraft({ number: "", name: "", weight: "1", manualStatus: "Auto", statusReason: "" }); setFormOpen(!formOpen); }}><IconPlus size={17} /> Add facility</button></div></section>
    {formOpen && <form className="panel building-form" onSubmit={onSubmit}>
      <div className="form-panel-heading"><h2>{draft.id ? "Edit facility details" : "New facility"}</h2><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Dismiss"><IconX size={17} /></button></div>
      <div className="form-grid three-cols">
        <Field label="Facility number"><input required maxLength={80} value={draft.number} onChange={(event) => setDraft({ ...draft, number: event.target.value })} placeholder="e.g. B-01" /></Field>
        <Field label="Facility name"><input required maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Facility name" /></Field>
        <Field label="Project weight"><input required type="number" min="0.01" step="any" value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: event.target.value })} /></Field>
        <Field label="Status"><select value={draft.manualStatus} onChange={(event) => setDraft({ ...draft, manualStatus: event.target.value })}><option value="Auto">Automatic from progress</option><option value="Delayed">Delayed</option><option value="On Hold">On hold</option><option value="Removed from Scope">Removed from scope</option></select></Field>
        {(draft.manualStatus === "Delayed" || draft.manualStatus === "On Hold") && <Field label="Status reason" className="field-full"><textarea required maxLength={1000} rows={2} value={draft.statusReason} onChange={(event) => setDraft({ ...draft, statusReason: event.target.value })} placeholder={draft.manualStatus === "Delayed" ? "Explain why this facility is delayed" : "Explain why work is on hold"} /></Field>}
      </div>
      {error && <p role="alert" className="inline-error">Unable to save. Check the facility number and entered details.</p>}
      <div className="form-actions">
        {draft.id && <AlertDialog.Root open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialog.Trigger asChild><button type="button" className="button-secondary button-danger"><IconTrash size={15} /> Delete facility</button></AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="delete-dialog-overlay" />
            <AlertDialog.Content className="delete-dialog-content">
              <AlertDialog.Title className="delete-dialog-title">Delete {draft.number}?</AlertDialog.Title>
              <AlertDialog.Description className="delete-dialog-description">This permanently deletes {draft.name}, its saved activity progress, and its audit history. This cannot be undone.</AlertDialog.Description>
              <div className="delete-dialog-actions">
                <AlertDialog.Cancel asChild><button type="button" className="button-secondary" disabled={isDeleting}>Cancel</button></AlertDialog.Cancel>
                <button type="button" className="button-primary button-delete-confirm" disabled={isDeleting} onClick={() => onDelete(draft.id)}><IconTrash size={15} />{isDeleting ? "Deleting…" : "Delete facility"}</button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>}
        <button type="submit" className="button-primary" disabled={isSaving || isDeleting}><IconCheck size={16} />{isSaving ? "Saving…" : "Save facility"}</button>
      </div>
    </form>}
    <section className="panel list-panel">
      <div className="list-toolbar"><div className="search-field"><IconSearch size={17} /><input aria-label="Search facilities" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by number or name…" /></div><div className="filter-field"><label htmlFor="building-status-filter">Status</label><select id="building-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="All">All statuses</option>{Object.keys(statusLabels).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div><span className="result-count">{buildings.length} of {allCount}</span></div>
      {buildings.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>#</th><th>Facility number</th><th>Facility name</th><th>Weight</th><th>Relative weight</th><th>Progress</th><th>Status</th><th>Last update</th><th /></tr></thead><tbody>{buildings.map((building: any, index: number) => <tr key={building.id}>
        <td className="table-muted">{index + 1}</td><td className="building-number">{building.number}</td><td><button type="button" className="table-building-link" onClick={() => onSelect(building.id)}>{building.name}</button></td><td>{formatPercent(building.weight)}</td><td>{formatPercent(building.relativeWeight)}%</td><td><div className="table-progress"><span className="progress-track"><i style={{ width: `${Math.min(building.overallProgress, 100)}%` }} /></span><strong>{formatPercent(building.overallProgress)}%</strong></div></td><td><StatusBadge status={building.status} />{building.statusReason && <small className="building-status-reason">{building.statusReason}</small>}</td><td className="table-muted">{building.updatedAt ? formatDate(building.updatedAt) : "—"}</td><td><button type="button" className="row-open" onClick={() => onSelect(building.id)}>Details <IconChevronLeft size={14} /></button></td>
      </tr>)}</tbody></table></div> : <EmptyState title={allCount ? "No matching facilities" : "No facilities recorded yet"} detail={allCount ? "Adjust the search or status filter." : "Add a facility to begin, or provide the Excel file to load actual project data."} action={!allCount ? <button type="button" className="button-primary" onClick={() => setFormOpen(true)}><IconPlus size={16} /> Add first facility</button> : undefined} />}
    </section>
    <div className="data-provenance">Relative weight is calculated from registered facility weights. Progress is never entered manually.</div>
  </div>;
}

function BuildingDetails({ building, onBack, onEdit, progressDraft, setProgressDraft, onSaveProgress, isSaving, error }: any) {
  return <div className="page-content">
    <button type="button" className="back-link" onClick={onBack}><IconChevronLeft size={16} /> Back to facilities</button>
    <section className="detail-hero panel">
      <div className="detail-identity"><span className="detail-building-icon"><IconBuilding size={22} /></span><div><div className="section-kicker">Facility · {building.number}</div><h1>{building.name}</h1></div></div>
      <div className="detail-actions"><StatusBadge status={building.status} /><button type="button" className="button-secondary" onClick={onEdit}><IconSettings size={16} /> Edit details</button></div>
      <div className="detail-metrics"><Metric label="Weight" value={`${formatPercent(building.weight)} units`} /><Metric label="Relative weight" value={`${formatPercent(building.relativeWeight)}%`} /><Metric label="Weighted progress" value={`${formatPercent(building.overallProgress)}%`} /><Metric label="Last update" value={building.updatedAt ? formatDate(building.updatedAt) : "Not updated yet"} /></div>
    </section>
    <section className="panel detail-activities">
      <div className="panel-heading"><div><h2>Activities &amp; progress</h2><span>Weighted progress = activity weight × completion percentage</span></div><span className="panel-unit">{building.activities.length} activities</span></div>
      <div className="activity-table-head"><span>Activity</span><span>Weight</span><span>Progress</span><span>Weighted contribution</span><span>Save</span></div>
      {building.activities.map((activity: any) => <div className="activity-edit-row" key={activity.id}>
        <span className="activity-name-cell"><strong>{activity.name}</strong><small>{activity.progress === 100 ? "Completed" : activity.progress > 0 ? "In progress" : "Not started"}</small></span>
        <span className="weight-cell">{formatPercent(activity.weight)}%</span>
        <div className="activity-input-cell"><div className="input-suffix"><input aria-label={`${activity.name} progress`} type="number" min="0" max="100" step="1" value={progressDraft[activity.id] ?? String(activity.progress)} onChange={(event) => setProgressDraft((previous: any) => ({ ...previous, [activity.id]: event.target.value }))} /><span>%</span></div></div>
        <strong className="weighted-cell">{formatPercent(activity.weightedProgress)}%</strong>
        <button type="button" className="save-progress-button" disabled={isSaving || Number(progressDraft[activity.id] ?? activity.progress) === activity.progress} onClick={() => onSaveProgress(building.id, activity.id, activity.progress)} aria-label={`Save ${activity.name} progress`}><IconCheck size={16} /></button>
      </div>)}
      {error && <p role="alert" className="inline-error">Unable to update progress. Check the value and try again.</p>}
      <div className="detail-total"><span>Total facility progress</span><strong>{formatPercent(building.overallProgress)}%</strong></div>
    </section>
    <div className="data-provenance"><IconShieldCheck size={15} /> Each update records the user, timestamp, and previous and new values.</div>
  </div>;
}

function SettingsView({ projectDraft, setProjectDraft, activityDraft, setActivityDraft, activeWeightTotal, isSaving, error, onSave }: any) {
  const validTotal = Math.abs(activeWeightTotal - 100) < 0.001;
  return <div className="page-content">
    <section className="page-heading-row"><div><div className="section-kicker"><span className="kicker-square" /> PROJECT ADMINISTRATION</div><h1>Settings</h1></div></section>
    <form className="settings-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Project details</h2><span>Project identification and schedule</span></div><IconShieldCheck size={18} className="panel-heading-icon" /></div>
        <div className="form-grid two-cols">
          <Field label="Project name"><input required maxLength={200} value={projectDraft.name} onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })} /></Field>
          <Field label="Project status"><select value={projectDraft.status} onChange={(event) => setProjectDraft({ ...projectDraft, status: event.target.value })}><option value="In Progress">In progress</option><option value="On Hold">On hold</option><option value="Completed">Completed</option></select></Field>
          <Field label="Project start date"><input type="date" value={projectDraft.startDate} onChange={(event) => setProjectDraft({ ...projectDraft, startDate: event.target.value })} /></Field>
          <Field label="Planned completion date"><input type="date" value={projectDraft.plannedCompletionDate} onChange={(event) => setProjectDraft({ ...projectDraft, plannedCompletionDate: event.target.value })} /></Field>
          <Field label="Project description" className="field-full"><textarea rows={3} maxLength={2000} value={projectDraft.description} onChange={(event) => setProjectDraft({ ...projectDraft, description: event.target.value })} /></Field>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Activity weights</h2><span>Enabled activity weights must total 100%</span></div><span className={`weight-total ${validTotal ? "is-valid" : "is-invalid"}`}><strong>{formatPercent(activeWeightTotal)}%</strong><small>{validTotal ? "Balanced" : "Must equal 100%"}</small></span></div>
        <div className="weight-table-head"><span>Activity</span><span>Weight %</span><span>Status</span></div>
        {activityDraft.map((activity: ActivityDraft, index: number) => <div className={`weight-edit-row ${activity.enabled ? "" : "is-disabled"}`} key={activity.id ?? `new-${index}`}>
          <input aria-label="Activity name" value={activity.name} onChange={(event) => setActivityDraft((previous: ActivityDraft[]) => previous.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
          <div className="input-suffix"><input aria-label="Activity weight" type="number" min="0" max="100" step="0.1" value={activity.weight} onChange={(event) => setActivityDraft((previous: ActivityDraft[]) => previous.map((item, i) => i === index ? { ...item, weight: Number(event.target.value) } : item))} /><span>%</span></div>
          <button type="button" className={`state-toggle ${activity.enabled ? "enabled" : ""}`} onClick={() => setActivityDraft((previous: ActivityDraft[]) => previous.map((item, i) => i === index ? { ...item, enabled: !item.enabled } : item))}>{activity.enabled ? "Enabled" : "Disabled"}</button>
        </div>)}
        <button type="button" className="add-activity-button" onClick={() => setActivityDraft((previous: ActivityDraft[]) => [...previous, { name: "New activity", weight: 0, sortOrder: previous.length, enabled: true }])}><IconPlus size={16} /> Add activity</button>
      </section>
      {error && <div role="alert" className="error-banner">Not saved. Enabled activity weights must total exactly 100%.</div>}
      <div className="settings-save-row"><span className="settings-save-note">Activity weights cannot be saved unless their total is 100%.</span><button type="submit" className="button-primary" disabled={!validTotal || isSaving}><IconCheck size={16} />{isSaving ? "Saving…" : "Save settings"}</button></div>
    </form>
  </div>;
}

function SiteMapView({ buildings, zoom, setZoom, pan, setPan, isPanMode, setIsPanMode, selectedBuildingId, setSelectedBuildingId, isDrawing, setIsDrawing, polygonDraft, setPolygonDraft, isSaving, onSavePolygon, onSelect, onOpenDetails }: any) {
  const [isPanning, setIsPanning] = useState(false);
  const [mapImage, setMapImage] = useState(APRC_MAP_IMAGE);
  const [mapImageName, setMapImageName] = useState("APRC aerial site overview");
  const [mapImageError, setMapImageError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mapImageInputRef = useRef<HTMLInputElement>(null);
  const mapCanvasRef = useRef<HTMLElement>(null);
  const mapPointerRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ pointerId: number; button: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const selectedBuilding = buildings.find((building: any) => building.id === selectedBuildingId);

  useEffect(() => {
    let cancelled = false;
    async function loadSavedMapImage() {
      try {
        const savedImage = await requestMapImageStore<StoredMapImage | undefined>("readonly", (store) => store.get("current"));
        if (cancelled) return;
        if (savedImage) {
          setMapImage(URL.createObjectURL(savedImage.file));
          setMapImageName(savedImage.name);
          return;
        }
        const legacyImage = window.localStorage.getItem(MAP_IMAGE_STORAGE_KEY);
        if (legacyImage) {
          setMapImage(legacyImage);
          setMapImageName(window.localStorage.getItem(`${MAP_IMAGE_STORAGE_KEY}:name`) ?? "Custom map image");
        }
      } catch {
        if (!cancelled) setMapImageError("The saved map image could not be loaded in this browser.");
      }
    }
    void loadSavedMapImage();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (mapImage.startsWith("blob:")) URL.revokeObjectURL(mapImage);
  }, [mapImage]);

  useEffect(() => {
    function syncFullscreenState() {
      setIsFullscreen(document.fullscreenElement === mapCanvasRef.current);
    }
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    function handleMapWheel(event: WheelEvent) {
      event.preventDefault();
      zoomMap(Math.max(0.7, Math.min(MAX_MAP_ZOOM, zoom * (event.deltaY < 0 ? 1.1 : 0.9))), event.clientX, event.clientY);
    }
    canvas.addEventListener("wheel", handleMapWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleMapWheel);
  }, [zoom]);

  async function handleMapImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMapImageError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_MAP_IMAGE_BYTES) {
      setMapImageError("Map images must be 15 MB or smaller.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      await requestMapImageStore<IDBValidKey>("readwrite", (store) => store.put({ file, name: file.name }, "current"));
      try {
        window.localStorage.removeItem(MAP_IMAGE_STORAGE_KEY);
        window.localStorage.removeItem(`${MAP_IMAGE_STORAGE_KEY}:name`);
      } catch {}
      setMapImage(URL.createObjectURL(file));
      setMapImageName(file.name);
      setMapImageError("");
    } catch {
      setMapImageError("Could not save this image in the browser. Try a smaller image or free browser storage.");
    }
  }

  async function resetMapImage() {
    try {
      await requestMapImageStore<undefined>("readwrite", (store) => store.delete("current"));
      try {
        window.localStorage.removeItem(MAP_IMAGE_STORAGE_KEY);
        window.localStorage.removeItem(`${MAP_IMAGE_STORAGE_KEY}:name`);
      } catch {}
      setMapImage(APRC_MAP_IMAGE);
      setMapImageName("APRC aerial site overview");
      setMapImageError("");
    } catch {
      setMapImageError("Could not remove the saved image from this browser.");
    }
  }
  const mappedBuildings = buildings.flatMap((building: any) => {
    const points = building.mapPolygon ? JSON.parse(building.mapPolygon) as [number, number][] : [];
    return points.length >= 3 ? [{ building, points }] : [];
  });

  function handleCanvasClick(event: React.MouseEvent<HTMLElement>) {
    if (event.button === 1 || isDrawing || suppressClickRef.current) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".map-polygon-group, .map-selection-card, .map-fullscreen-button")) return;
    setSelectedBuildingId("");
  }

  function startPan(event: React.PointerEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target : null;
    const isMiddleButton = event.button === 1;
    if ((!isMiddleButton && (!isPanMode || isDrawing)) || target?.closest(".map-selection-card, .map-canvas-label, .map-image-note, .map-fullscreen-button")) return;
    if (isMiddleButton) event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panStartRef.current = { pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, panX: pan[0], panY: pan[1], moved: false };
    setIsPanning(true);
  }

  function movePan(event: React.PointerEvent<HTMLElement>) {
    mapPointerRef.current = { x: event.clientX, y: event.clientY };
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 3) start.moved = true;
    if (start.moved) setPan([start.panX + deltaX, start.panY + deltaY]);
  }

  function finishPan(event: React.PointerEvent<HTMLElement>) {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    suppressClickRef.current = start.moved || start.button === 1;
    if (suppressClickRef.current) window.setTimeout(() => { suppressClickRef.current = false; }, 250);
    panStartRef.current = null;
    setIsPanning(false);
  }

  function resetMap() {
    setZoom(1);
    setPan([0, 0]);
  }

  async function toggleMapFullscreen() {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    try {
      if (document.fullscreenElement === canvas) await document.exitFullscreen();
      else await canvas.requestFullscreen();
      setMapImageError("");
    } catch {
      setMapImageError("Fullscreen mode is unavailable in this browser.");
    }
  }

  function zoomMap(nextZoom: number, clientX?: number, clientY?: number) {
    const canvas = mapCanvasRef.current;
    if (!canvas || zoom === 0) {
      setZoom(nextZoom);
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const pointer = clientX === undefined || clientY === undefined
      ? mapPointerRef.current ?? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      : { x: clientX, y: clientY };
    const offsetX = pointer.x - bounds.left - bounds.width / 2;
    const offsetY = pointer.y - bounds.top - bounds.height / 2;
    const zoomRatio = nextZoom / zoom;
    setPan(([panX, panY]: [number, number]) => [
      panX + (offsetX - panX) * (1 - zoomRatio),
      panY + (offsetY - panY) * (1 - zoomRatio),
    ]);
    setZoom(nextZoom);
  }

  function addPolygonPoint(event: React.MouseEvent<SVGSVGElement>) {
    if (!isDrawing || !selectedBuilding) return;
    const cursor = event.currentTarget.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const point = cursor.matrixTransform(event.currentTarget.getScreenCTM()!.inverse());
    const x = Math.max(0, Math.min(800, Math.round(point.x * 10) / 10));
    const y = Math.max(0, Math.min(512, Math.round(point.y * 10) / 10));
    setPolygonDraft((previous: [number, number][]) => [...previous, [x, y]]);
  }

  function beginDrawing() {
    setIsPanMode(false);
    setPolygonDraft([]);
    setIsDrawing(true);
  }

  function cancelDrawing() {
    setPolygonDraft([]);
    setIsDrawing(false);
  }

  return <div className="page-content">
    <section className="page-heading-row"><div><div className="section-kicker"><span className="kicker-square" /> SITE VIEW</div><h1>Site map</h1></div><div className="schematic-tag"><span /> {mappedBuildings.length} of {buildings.length} facilities mapped</div></section>
    <section className="map-toolbar panel">
      <div className="map-image-source"><IconMap2 size={16} /> <span title={mapImageName}>{mapImageName}</span></div>
      <button type="button" className="button-secondary compact" onClick={() => mapImageInputRef.current?.click()}>Upload image</button>
      <input ref={mapImageInputRef} className="map-image-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload map image" onChange={handleMapImageUpload} />
      {mapImage !== APRC_MAP_IMAGE && <button type="button" className="button-secondary compact" onClick={() => { void resetMapImage(); }}>Restore APRC image</button>}
      {mapImageError && <span className="map-upload-error" role="status">{mapImageError}</span>}
      <label className="map-facility-select"><span>Facility</span><select value={selectedBuildingId} onChange={(event) => { cancelDrawing(); setSelectedBuildingId(event.target.value); }}><option value="">Select a facility</option>{buildings.map((building: any) => <option key={building.id} value={building.id}>{building.number} · {building.name}</option>)}</select></label>
      {!isDrawing ? <button type="button" className="button-secondary compact" disabled={!selectedBuilding} onClick={beginDrawing}>{selectedBuilding?.mapPolygon ? "Redraw polygon" : "Draw polygon"}</button> : <>
        <span className="map-draw-hint">Click the map to add boundary points</span>
        <button type="button" className="button-secondary compact" onClick={cancelDrawing}>Cancel</button>
        <button type="button" className="button-primary compact" disabled={polygonDraft.length < 3 || isSaving} onClick={() => onSavePolygon(selectedBuilding, polygonDraft)}>{isSaving ? "Saving…" : "Save polygon"}</button>
      </>}
      {selectedBuilding?.mapPolygon && !isDrawing && <button type="button" className="button-secondary compact" disabled={isSaving} onClick={() => onSavePolygon(selectedBuilding, [])}>Clear polygon</button>}
      <button type="button" className={`button-secondary compact map-pan-toggle ${isPanMode ? "is-selected" : ""}`} aria-pressed={isPanMode} onClick={() => { cancelDrawing(); setIsPanMode(!isPanMode); }}><IconHandMove size={15} /> Pan</button>
      <div className="map-zoom-controls"><button type="button" onClick={() => zoomMap(Math.min(zoom + 0.25, MAX_MAP_ZOOM))} aria-label="Zoom in"><IconPlus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => zoomMap(Math.max(zoom - 0.25, 0.7))} aria-label="Zoom out"><IconMinus size={16} /></button><button type="button" onClick={resetMap} aria-label="Reset view">Reset view</button></div>
    </section>
    <section ref={mapCanvasRef} className={`map-canvas panel ${isDrawing ? "is-drawing" : isPanning ? "is-panning" : isPanMode ? "is-pan-mode" : ""}`} aria-label="APRC aerial site overview" onClick={handleCanvasClick} onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={finishPan} onPointerCancel={finishPan}>
      <button type="button" className="map-fullscreen-button" onClick={() => { void toggleMapFullscreen(); }} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>{isFullscreen ? <IconMinimize size={17} /> : <IconMaximize size={17} />}</button>
      <div className="map-image-transform" style={{ transform: `translate(${pan[0]}px,${pan[1]}px) scale(${zoom})` }}>
      <img className="site-map-image" src={mapImage} alt={mapImageName} />
      <svg className="map-polygon-layer" viewBox="0 0 800 512" preserveAspectRatio="none" onClick={addPolygonPoint} aria-label="Building boundary polygons">
        <rect width="800" height="512" fill="transparent" pointerEvents={isDrawing ? "all" : "none"} />
        {mappedBuildings.map(({ building, points }: any) => {
          const centerX = points.reduce((sum: number, point: [number, number]) => sum + point[0], 0) / points.length;
          const centerY = points.reduce((sum: number, point: [number, number]) => sum + point[1], 0) / points.length;
          const nameLines = wrapMapLabel(building.name, 18);
          const firstLineOffset = -((nameLines.length) * 0.55);
          return <g key={building.id} className={`map-polygon-group ${statusClass[building.status]} ${building.id === selectedBuildingId ? "is-selected" : ""}`} role="button" tabIndex={0} onClick={(event) => { if (!isDrawing && !suppressClickRef.current) { event.stopPropagation(); onSelect(building.id); } suppressClickRef.current = false; }} onKeyDown={(event) => { if (!isDrawing && (event.key === "Enter" || event.key === " ")) onSelect(building.id); }} style={{ pointerEvents: isDrawing ? "none" : "auto" }}>
            <polygon points={points.map(([x, y]: [number, number]) => `${x},${y}`).join(" ")} style={{ strokeWidth: building.id === selectedBuildingId ? MAP_POLYGON_STROKE_WIDTH * 2 : MAP_POLYGON_STROKE_WIDTH, vectorEffect: "non-scaling-stroke" }} />
            <text x={centerX} y={centerY} style={{ fontSize: `${MAP_LABEL_FONT_SIZE}px`, fontWeight: 600, dominantBaseline: "middle", paintOrder: "stroke", stroke: "rgba(12, 18, 26, 0.22)", strokeWidth: 0.35 }}>
              <tspan x={centerX} dy={`${firstLineOffset}em`}>{building.number}</tspan>
              {nameLines.map((line: string, index: number) => <tspan key={index} x={centerX} dy={index === 0 ? "1.1em" : "1.1em"}>{line}</tspan>)}
            </text>
          </g>;
        })}
        {isDrawing && polygonDraft.length > 0 && <g className="map-polygon-draft"><polygon points={polygonDraft.map(([x, y]: [number, number]) => `${x},${y}`).join(" ")} style={{ strokeWidth: MAP_DRAFT_STROKE_WIDTH, vectorEffect: "non-scaling-stroke" }} /><polyline points={polygonDraft.map(([x, y]: [number, number]) => `${x},${y}`).join(" ")} style={{ strokeWidth: MAP_DRAFT_STROKE_WIDTH, vectorEffect: "non-scaling-stroke" }} />{polygonDraft.map(([x, y]: [number, number], index: number) => <circle key={index} cx={x} cy={y} r={MAP_POINT_RADIUS} style={{ vectorEffect: "non-scaling-stroke" }} />)}</g>}
      </svg>
      </div>
      <div className="map-canvas-label"><IconMap2 size={16} /> APRC · 31.097298° N, 29.866702° E</div>
      {selectedBuilding && <section className={`map-selection-card ${statusClass[selectedBuilding.status]}`} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="map-selection-close" aria-label="Close facility summary" onClick={() => setSelectedBuildingId("")}><IconX size={15} /></button>
        <div className="map-selection-kicker">FACILITY {selectedBuilding.number}</div><h2>{selectedBuilding.name}</h2>
        <div className="map-selection-status"><StatusBadge status={selectedBuilding.status} /><strong>{formatPercent(selectedBuilding.overallProgress)}%</strong></div>
        {selectedBuilding.statusReason && <p className="map-selection-reason">{selectedBuilding.statusReason}</p>}
        <div className="progress-track"><i style={{ width: `${Math.min(selectedBuilding.overallProgress, 100)}%` }} /></div>
        <div className="map-selection-activities">{selectedBuilding.activities.map((activity: any) => <div key={activity.id}><span>{activity.name}</span><strong>{formatPercent(activity.progress)}%</strong></div>)}</div>
        <button type="button" className="map-selection-details" onClick={() => onOpenDetails(selectedBuilding.id)}>View facility details</button>
      </section>}
      <div className="map-status-legend">{["Completed", "In Progress", "Delayed", "Not Started", "On Hold", "Removed from Scope"].map((status) => <span key={status}><i className={`status-dot ${statusClass[status]}`} />{statusLabels[status]}</span>)}</div>
      <div className="map-image-note">{isDrawing ? "Mark at least 3 points around the facility, then save." : isPanMode ? "Drag or middle-drag to pan · scroll or use +/- to zoom" : "Middle-drag to pan · select a polygon for facility details"}</div>
    </section>
    <div className="data-provenance">Custom map images are saved in this browser. If the image framing changes, check and redraw facility polygons as needed.</div>
  </div>;
}

function ReportsView({ data, onExportBuildings, onExportActivityProgress, onExportHistory }: any) {
  const activityColumnCount = (data?.activities ?? []).filter((activity: any) => activity.enabled).length;
  return <div className="page-content">
    <section className="page-heading-row"><div><div className="section-kicker"><span className="kicker-square" /> PROJECT OUTPUTS</div><h1>Reports &amp; exports</h1></div></section>
    <div className="report-cards">
      <div className="panel report-card"><span className="report-icon"><IconBuilding size={19} /></span><div><h2>Facility progress report</h2><p>{data?.buildings.length ?? 0} facilities · weighted progress, weights, and status</p></div><button type="button" className="button-secondary" onClick={onExportBuildings}><IconDownload size={16} /> CSV</button></div>
      <div className="panel report-card"><span className="report-icon activities"><IconActivity size={19} /></span><div><h2>Activity progress by facility</h2><p>{activityColumnCount} activity columns · one row per facility</p></div><button type="button" className="button-secondary" onClick={onExportActivityProgress}><IconDownload size={16} /> CSV</button></div>
      <div className="panel report-card"><span className="report-icon history"><IconClock size={19} /></span><div><h2>Change history report</h2><p>{data?.history.length ?? 0} recent updates · user, values, and timestamp</p></div><button type="button" className="button-secondary" onClick={onExportHistory}><IconDownload size={16} /> CSV</button></div>
    </div>
  </div>;
}

function HistoryView({ history, onExport }: any) {
  return <div className="page-content">
    <section className="page-heading-row"><div><div className="section-kicker"><span className="kicker-square" /> AUDIT TRAIL</div><h1>Change history</h1></div><button type="button" className="button-secondary" onClick={onExport}><IconDownload size={16} /> Export CSV</button></section>
    <section className="panel list-panel history-panel">
      {history.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>User</th><th>Date &amp; time</th><th>Facility number</th><th>Facility</th><th>Activity</th><th>Previous value</th><th>New value</th></tr></thead><tbody>{history.map((entry: any) => <tr key={entry.id}><td>{entry.actorEmail || "—"}</td><td className="table-muted">{formatDate(entry.createdAt)}</td><td className="building-number">{entry.buildingNumber}</td><td>{entry.buildingName}</td><td>{entry.activityName}</td><td>{formatPercent(entry.oldValue)}%</td><td><strong>{formatPercent(entry.newValue)}%</strong></td></tr>)}</tbody></table></div> : <EmptyState title="No changes recorded" detail="The audit trail will appear here after the first activity update." />}
    </section>
  </div>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="detail-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${statusClass[status] ?? ""}`}><i />{statusLabels[status] ?? status}</span>;
}

function EmptyInline({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-inline"><span className="empty-dot" /><span><strong>{title}</strong><small>{detail}</small></span></div>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-state-icon"><IconBuilding size={21} /></span><strong>{title}</strong><span>{detail}</span>{action}</div>;
}

function LoadingSurface() {
  return <div className="page-content" aria-label="Loading project data"><div className="skeleton skeleton-heading" /><div className="skeleton-grid">{Array.from({ length: 6 }, (_, index) => <div className="skeleton skeleton-kpi" key={index} />)}</div><div className="skeleton skeleton-panel" /></div>;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function wrapMapLabel(value: string, maxCharacters: number) {
  const lines: string[] = [];
  let currentLine = "";
  for (const word of value.trim().split(/\s+/)) {
    if (word.length > maxCharacters) {
      if (currentLine) lines.push(currentLine);
      const chunks = word.match(new RegExp(`.{1,${maxCharacters}}`, "g")) ?? [word];
      lines.push(...chunks.slice(0, -1));
      currentLine = chunks[chunks.length - 1];
    } else if (!currentLine) {
      currentLine = word;
    } else if (`${currentLine} ${word}`.length <= maxCharacters) {
      currentLine = `${currentLine} ${word}`;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [value];
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function downloadCsv(filename: string, headers: (string | number)[], rows: (string | number)[][]) {
  const quote = (value: string | number) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
