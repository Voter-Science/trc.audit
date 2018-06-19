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
    static parse(value: string): Mode {

        // Could be lots of parser errors
        var obj = bcl.KeyParser.parse(value);

        var clf = analyze.ChangelistFilter.parse(value);

        var kind = obj["show"];
        if (kind == "delta") {
            var ver = parseInt(obj["ver"]);
            return new ShowDelta(ver);
        }
        if (kind == "deltarange") {
            // var ver = parseInt(obj["ver"]);                    
            return new ShowDeltaRange(clf);

        }// sessions
        if (kind == "sessions") {
            return new ShowSessionList(clf);
        }
        throw ("Unidentified mode: " + kind);

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

// For setting in Table rows 
class ClickableValue<T> {
    public _next: () => Mode; // What happens when we click
    public _value: T;
    public constructor(value: T, next: () => Mode) {
        this._value = value;
        this._next = next;
    }

    public toString() { return this._value.toString(); };
}

interface ITableRow {
    // Properties aren't ordered. 
    getColumns(): string[];
}

class SessionRow {
    public User: string;
    public VoterCount: number;
    public VerStart: ClickableValue<number>;
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
    private _ctx: RenderContext;

    public constructor(root: JQuery<HTMLElement>, ctx: RenderContext) {
        this._root = root;
        this._count = 0;
        this._ctx = ctx;
    }

    public writeRow(row: T): void {
        if (this._count == 0) {
            // Writer header 

            this._table = $("<table>").attr("border", 1);
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
            var td = $("<td>");

            var val: any = (<any>row)[columnName];

            var next = val._next;
            if (next) {
                // clicabkle
                td = td.append(
                    clickable(this._ctx,
                        val.toString(),
                        next));
            } else {
                td.text(val);
            }
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
    private _clf: analyze.ChangelistFilter; // already has filter applied!

    public constructor(clf: analyze.ChangelistFilter) {
        super();
        this._clf = clf;
    }

    public toHash(): string {
        return "show=sessions;" + this._clf.toString();
    }

    public render(ctx: RenderContext): void {
        var cl = ctx.changelist;
        
        var cl = cl.applyFilter(this._clf);

        var users = cl.filterByUser();

        var table = new TableWriter<SessionRow>(ctx.element, ctx);


        users.forEach((user, cl) => {
            var clusters = cl.getClustering();
            clusters.forEach(cluster => {

                var row = new SessionRow();
                row.User = user;
                row.VoterCount = cluster.getUniqueCount();

                var verStart = cluster.getVersionRange().getStart();
                var verEnd = cluster.getVersionRange().getEnd();
                row.VerStart = new ClickableValue<number>(verStart,
                    () => {
                        // Clicking on version number takes us to that range. 
                        var clf = new analyze.ChangelistFilter()
                            .setUser(user)
                            .setVersionRange(cluster.getVersionRange());
                        return new ShowDeltaRange(clf);
                    }
                );
            

                row.VerEnd = verEnd;

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
    private _clf: analyze.ChangelistFilter; // already has filter applied!

    public constructor(filter: analyze.ChangelistFilter) {
        super();
        this._clf = filter;
    }

    public toHash(): string {
        return "show=deltarange;" + this._clf.toString();
    }


    public render(ctx: RenderContext): void {

        var cl = ctx.changelist;
        cl = cl.applyFilter(this._clf);

        var e1 = $("<table>");

        var tr = $("<tr>");
        var td1 = $("<td>").text("Version");
        var td2 = $("<td>").text("User");
        var td3 = $("<td>").text("UtcTime");
        tr.append(td1).append(td2).append(td3);
        e1.append(tr);

        cl.forEach((delta: trcSheet.IDeltaInfo) => {

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