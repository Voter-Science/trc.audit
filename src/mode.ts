import * as core from 'trc-core/core'
import * as trcSheet from 'trc-sheet/sheet'
import { SheetContentsIndex, SheetContents, ISheetContents } from 'trc-sheet/sheetContents';
import * as bcl from 'trc-analyze/collections'
import * as analyze from 'trc-analyze/core'
import * as trchtml from 'trc-web/html'

// Used for rending onto screen
declare var $: JQueryStatic;

// Different lists 

//  key=value;key=value;key=value

// Standard Changelist filters:
//     Version=45;VersionEnd=47;
//     Day=xxxxx
//     User=bob@contoso.com;
//     TimeStart=xxxx;TimeEnd=yyyyy
//     App=xxxxxxx

// Show an exact delta 
//   Show=Delta;Version=45
//
// Delta list. Optional filters. 
//   Show=DeltaList;
//      [ChangelistFilters]
//
// Session List. These are the clusters 
//   Show=Sessions
//      [ChangelistFilters]
//
// Daily Report:  Group clusters by day . data[User][Day] = # of active mintues.
//   Show=UsersDaily


// convert a date into a sortable integer. 
// YYYYMMDD
function sortableDay(x: Date): number {
    var year: number = x.getFullYear();     // 4 digit year 
    var month: number = 1 + x.getMonth(); // months are 0-based
    var day: number = x.getDate();  // days are 1-based 
    return year * 10000 + month * 100 + day;
}

function addNormalizedDay(x: ISheetContents, columnName: string, newColumnName: string): void {
    var col = x[columnName];

    var days: string[] = [];
    x[newColumnName] = days;

    for (var i in col) {
        var val = col[i];
        var d = new Date(val);

        var trStart = bcl.TimeRange.roundToDay(d);
        days.push(sortableDay(trStart).toString());
    }
}

// Context passed to rendering 
export class RenderContext {
    public changelist: analyze.Changelist;
    public element: JQuery<HTMLElement>;

    // used by click handlers 
    public Next: (mode: Mode) => void;
}

// Generate a clickable node that will take us to another view
function clickable(ctx: RenderContext, text: string, next: () => Mode): JQuery<HTMLElement> {
    var td1 = $("<button>").text(text).click(() => {
        var x = next();
        ctx.Next(x);
    });
    return td1;
}

// All modes are totally serializable. 
export abstract class Mode {
    static parse1(value: string): any {
        value = value.toLowerCase();
        // parse 
        var obj: any = {};
        var pairs = value.split(';')
        for (var i in pairs) {
            var pair = pairs[i];
            var halves = pair.split('=');
            var key = halves[0];
            var val = halves[1];
            obj[key] = val;
        }
        return obj;
    }
    static parse(value: string, analyzeClient: analyze.AnalyzeClient): Promise<Mode> {
        return new Promise<Mode>(
            (
                resolve: (result: Mode) => void,
                reject: (error: any) => void
            ) => {
                // Could be lots of parser errors
                var obj = Mode.parse1(value);

                var kind = obj["show"];
                if (kind == "delta") {
                    var ver = parseInt(obj["ver"]);
                    return resolve(new ShowDelta(ver));
                }
                if (kind == "deltarange") {
                    // var ver = parseInt(obj["ver"]);
                    return analyzeClient.getAllChangesAsync().then((cl) => {
                        return resolve(new ShowDeltaRange(cl));
                    });
                }// sessions
                if (kind == "sessions") {
                    return analyzeClient.getAllChangesAsync().then((cl) => {
                        return resolve(new ShowSessionList (cl));
                    });
                }

                reject("Unidentified mode: " + kind);
            });
    }

    public abstract render(ctx: RenderContext): void;

    public abstract toHash(): string;
}


// Shows a single delta at an exact version
export class ShowDelta extends Mode {
    private _ver: number;

    public constructor(ver: number) {
        super();
        this._ver = ver;
    }

    public render(ctx: RenderContext): void {
        var delta: trcSheet.IDeltaInfo = ctx.changelist.get(this._ver);

        var json = JSON.stringify(delta, null, 2);

        var e = $("<pre>").text(json);
        ctx.element.append(e);
    }

    public toHash(): string {
        return "show=delta;ver=" + this._ver;
    }
}

interface ITableRow {
    // Properties aren't ordered. 
    getColumns(): string[];
}

class SessionRow {
    public User: string;
    public VoterCount: number;
    public VerStart: number;
    public VerEnd: number;
    public DayNumber: number;
    public Day: string;
    public StartTime: string;
    public EndTime: string;
    public TotalMinutes: number;
    public TotalDuration: string;

    // public getColumns() : string[] {
    // return ["User", "VoterCount", ]
    //  return Object.getOwnPropertyNames(this);
    //}

}

class TableWriter<T> {
    private _root: JQuery<HTMLElement>;
    private _table: JQuery<HTMLElement>;
    private _count: number;
    private _columns: string[];

    public constructor(root: JQuery<HTMLElement>) {
        this._root = root;
        this._count = 0;
    }

    public writeRow(row: T): void {
        if (this._count == 0) {
            // Writer header 

            this._table = $("<table>");
            this._root.append(this._table);

            var tr = $("<tr>");

            this._columns = Object.getOwnPropertyNames(row);

            this._columns.forEach(val => {
                var td = $("<td>").text(val);
                tr.append(td);
            });
            this._table.append(tr);
        }

        var tr = $("<tr>");
        
        this._columns.forEach(columnName => {
            var val :any = (<any>row)[columnName];
            var td = $("<td>").text(val);
            tr.append(td);
        });
        this._table.append(tr);


        this._count++;
    }
}


// Filter: Day, User
// Click on VerStart -->  DeltaRange VerStart...VerEnd
// Click on VoterCount --> Which recids? 
// Click on househodls --> Which households?
export class ShowSessionList extends Mode {
    private _cl: analyze.Changelist; // already has filter applied!

    public constructor(changelist: analyze.Changelist) {
        super();
        this._cl = changelist;
    }

    public toHash(): string {
        // $$$
        // return "ver_range=" + this._cl.toString();
        return "show=sessions";
    }

    public render(ctx: RenderContext): void {
        var users = this._cl.filterByUser();

        var table = new TableWriter<SessionRow>(ctx.element);


        users.forEach((user, cl) => {
            var clusters = cl.getClustering();
            clusters.forEach(cluster => {

                var row = new SessionRow();
                row.User = user;
                row.VoterCount = cluster.getUniqueCount();
                row.VerStart = cluster.getVersionRange().getStart();
                row.VerEnd = cluster.getVersionRange().getEnd();

                var tr = cluster.getTimeRange();
                var trStart = bcl.TimeRange.roundToDay(tr.getStart());
                row.DayNumber = sortableDay(trStart);
                row.Day = trStart.toDateString();

                row.StartTime = tr.getStart().toLocaleTimeString();
                row.EndTime = tr.getEnd().toLocaleTimeString();

                row.TotalMinutes = Math.round(tr.getDurationSeconds() / 60);
                row.TotalDuration = bcl.TimeRange.prettyPrintSeconds(cluster.getTimeRange().getDurationSeconds());

                table.writeRow(row);
            });
        });
    }
}

// Shows a range of deltas 
// Clicks:
//   - on ver# --> ShowDelta(version)
export class ShowDeltaRange extends Mode {
    private _cl: analyze.Changelist; // already has filter applied!

    public constructor(changelist: analyze.Changelist) {
        super();
        this._cl = changelist;
    }

    public toHash(): string {
        // $$$
        // return "ver_range=" + this._cl.toString();
        return "show=deltarange";
    }


    public render(ctx: RenderContext): void {

        var e1 = $("<table>");

        var tr = $("<tr>");
        var td1 = $("<td>").text("Version");
        var td2 = $("<td>").text("User");
        var td3 = $("<td>").text("UtcTime");
        tr.append(td1).append(td2).append(td3);
        e1.append(tr);

        this._cl.forEach((delta: trcSheet.IDeltaInfo) => {

            var tr = $("<tr>");
            td1 = $("<td>").append(
                clickable(ctx,
                    delta.Version.toString(),
                    () => new ShowDelta(delta.Version)));

            var td2 = $("<td>").text(delta.User);
            var td3 = $("<td>").text(delta.Timestamp);
            tr.append(td1).append(td2).append(td3);
            e1.append(tr);
        });

        ctx.element.append(e1);
    }
}

/*
// Shows a single delta 
export class ShowAllVers extends Mode 
{
    public render(ctx : Context) : void {
        // Apply filters 
        var sc = ctx.changelist.normalizeByVer();


        addNormalizedDay(sc, "Timestamp", "DayNumber");

        var r = new trchtml.RenderSheet("contents", sc);
        r.render();
    }
}

export class FlattenToRecId extends Mode 
{
    public render(ctx : Context) : void {
        // Apply filters 
        var sc = ctx.changelist.flattenByRecId();

        var r = new trchtml.RenderSheet("contents", sc);
        r.render();
    }
}*/