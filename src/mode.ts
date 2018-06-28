import * as core from 'trc-core/core'
import * as trcSheet from 'trc-sheet/sheet'
import { SheetContentsIndex, SheetContents, ISheetContents } from 'trc-sheet/sheetContents';
import * as bcl from 'trc-analyze/collections'
import * as analyze from 'trc-analyze/core'
import * as hh from 'trc-analyze/household'
import * as trchtml from 'trc-web/html'

// Used for rending onto screen
declare var $: JQueryStatic;

declare var google: any;

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

// Round a date to the start date in local time. 
function rountToLocalStartDay(d: Date): Date {

    var year = d.getFullYear(); // 2018 
    var month = d.getMonth(); // 0-based; but Date ctor is also 0-based
    var date = d.getDate(); //  1-based 

    return new Date(year, month, date);

    /*
        const p = 24 * 60 * 60 * 1000; // milliseconds in a day 
    
        var t = d.getTime(); // Milliseconds  since UTC
    
        var start = Math.round(t / p) * p; // start of UTC day
    
        var minutes = d.getTimezoneOffset(); //  minutes, ie 420 = 7 hours. 
        start += minutes *60 *1000; // adjust to local time
        
        return new Date(start);*/
}

/*
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
}*/

// Context passed to rendering 
export class RenderContext {
    public changelist: analyze.Changelist;
    public normChangelist: analyze.NormChangeList;

    public householder: hh.IHousheholding;

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

// Static description of the different modes. 
export class ModeDescr {
    public static List: ModeDescr[] = [
        new ModeDescr("daily", "Show a daily report for all users"),
        new ModeDescr("sessions", "Show active sessions for users"),
        new ModeDescr("ndeltarange", "Show individual results"),
        new ModeDescr("delta", "Show single raw delta"),
        new ModeDescr("deltarange", "Show range of raw deltas"),
        new ModeDescr("byrecid", "Show deltas grouped by RecId"),
    ];

    public static lookup(name: string): ModeDescr {
        for (var descr of ModeDescr.List) {
            if (descr._hashName == name) {
                return descr;
            }
        }
        return undefined;
    }

    public readonly _hashName: string;
    public readonly _descr: string;

    public useVerNum(): boolean {
        return this._hashName == "delta";
    }
    public useUsers(): boolean {
        return this._hashName != "delta";
    }
    public useTimeRange(): boolean {
        return this._hashName != "delta";
    }

    constructor(hashName: string, descr: string) {
        this._hashName = hashName;
        this._descr = descr;
    }
}

// All modes are totally serializable. 
export abstract class Mode {
    static parse(value: string): Mode {

        // Could be lots of parser errors
        var obj = bcl.KeyParser.parse(value);

        var normFilter = analyze.NormChangeListFilter.parse(value);
        var clf = analyze.ChangelistFilter.parse(value);

        var kind = obj["show"];
        if (kind == "delta") {
            var ver = parseInt(obj["ver"]);
            return new ShowDelta(ver);
        }
        if (kind == "deltarange") {
            // var ver = parseInt(obj["ver"]);                    
            return new ShowDeltaRange(clf);

        } // sessions

        if (kind == "sessions") {
            return new ShowSessionList(normFilter);
        }

        if (kind == "ndeltarange") {
            return new ShowNDeltaRange(normFilter);
        }

        // Flatten by RecId, like Blame report. 
        if (kind == "byrecid") {
            return new ShowFlattenToRecId(clf);
        }

        if (kind == "daily") {
            return new ShowDailyReport(normFilter);
        }
        throw ("Unidentified mode: " + kind);

    }

    public getDescription(): string { return ""; }

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
        var delta: trcSheet.IDeltaInfo = ctx.changelist.getRawDelta(this._ver);

        var json = JSON.stringify(delta, null, 2);

        var e = $("<pre>").text(json);
        ctx.element.append(e);
    }

    public toHash(): string {
        return "show=delta;ver=" + this._ver;
    }

    public getDescription(): string {
        return "This is an advanced view. It shows an individual piece of information (a 'delta') uploaded by the mobile clients. " +
            "Each delta is given a unique version number, and may edit one of more RecIds."
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

class SessionRow {
    public User: string;
    public VoterCount: number;
    public VerStart: ClickableValue<number>;
    //public VerEnd: number;
    public DayNumber: number;
    public Day: string;
    public StartTime: string;
    public EndTime: string;
    public TotalMinutes: number;
    public TotalDuration: string;

    public Distance: number;
    public HouseholdCount: number;

    public GapDistanceKM: number;
    public GapTimeMinutes: number;
}

class TableWriter<T> {
    private _root: JQuery<HTMLElement>;
    private _table: JQuery<HTMLElement>;
    private _count: number;
    private _columns: string[];
    private _ctx: RenderContext;

    public constructor(root: JQuery<HTMLElement>, ctx: RenderContext, columnsNames?: string[]) {
        this._root = root;
        this._count = 0;
        this._ctx = ctx;
        this._columns = columnsNames;
    }

    public writeRow(row: T): void {
        if (this._count == 0) {
            // Writer header 

            this._table = $("<table>").attr("border", '1');
            this._root.append(this._table);

            var tr = $("<tr>");

            if (!this._columns) {
                this._columns = Object.getOwnPropertyNames(row);
            }

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
            if (!!val) {
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
            }
            tr.append(td);
        });
        this._table.append(tr);


        this._count++;
    }
}

class MapHelper {
    public init(cl: analyze.NormChangeList): void {
        $("#map").show();
        var map = new google.maps.Map(document.getElementById('map'));

        var infowindow = new google.maps.InfoWindow();
        var bounds = new google.maps.LatLngBounds();
        var latLng: any = {};

        // Draw a walkpath 
        var users = cl.getUsers();

        var userCls = cl.filterByUser();


        for (var i in users) {
            var randomColor = '#' + ('000000' + Math.floor(Math.random() * 16777215).toString(16)).slice(-6);

            var user: string = users[i];
            var userCl = userCls.get(user);

            // path is array of {lat,lng}
            var path: any = [];

            userCl.forEach(delta => {

                var pst = new google.maps.LatLng(delta.xloc.Lat, delta.xloc.Long);

                /*
                var marker = new google.maps.Marker({
                    position: pst,
                    map: map
                });
                */

                /*
                var infoContent = '<div class="info_content">' +
                '<h3>' + delta.delta +"-" + delta.deltaIdx + '</h3>' +
                '<p>' + delta.getUser() + '</p></div>';
                */

                /*
                google.maps.event.addListener(marker, 'click', (function (marker, j, infoContent) {
                    return function () {
                        infowindow.setContent(infoContent);
                        infowindow.open(map, marker);
                    }
                })(marker, j, infoContent));*/

                path.push({ lat: delta.xloc.Lat, lng: delta.xloc.Long });
                bounds.extend(pst);
            });

            var flightPath = new google.maps.Polyline({
                path: path,
                geodesic: true,
                strokeColor: randomColor,
                strokeOpacity: 1.0,
                strokeWeight: 3
            });
            flightPath.setMap(map);

        } // per user


        map.fitBounds(bounds);       // auto-zoom
        map.panToBounds(bounds);     // auto-center
    }
}


// Shows list of sessions (Clusters)
// Filter: Day, User
// Click on VerStart -->  DeltaRange VerStart...VerEnd
// Click on VoterCount --> Which recids? 
// Click on househodls --> Which households?
export class ShowSessionList extends Mode {
    private _clf: analyze.NormChangeListFilter; // already has filter applied!

    public constructor(clf: analyze.NormChangeListFilter) {
        super();
        this._clf = clf;
    }

    public getDescription(): string {
        return "This shows 'sessions' - which are continuous periods of active usage where the user is submitting results."
    }

    public toHash(): string {
        return "show=sessions;" + this._clf.toString();
    }

    public render(ctx: RenderContext): void {
        var cl = ctx.normChangelist;
        var cl = cl.applyFilter(this._clf);

        var m = new MapHelper();
        m.init(cl);

        var users = cl.filterByUser();
        var table = new TableWriter<SessionRow>(ctx.element, ctx);

        var totals: SessionRow = new SessionRow();
        totals.User = "Total";
        totals.VoterCount = 0;
        totals.HouseholdCount = 0;
        totals.Distance = 0;
        totals.TotalMinutes = 0;

        users.forEach((user, cl) => {
            var clusters = cl.getClustering();

            var lastLoc: bcl.IGeoPoint;
            var lastTime: Date;

            clusters.forEach(cluster => {

                var row = new SessionRow();
                row.User = user;
                row.VoterCount = cluster.getUniqueCount();

                var verStart = cluster.getTimeRange().getStart();
                //var verEnd = cluster.getTimeRange().getEnd();
                row.VerStart = new ClickableValue<number>(verStart.valueOf(),
                    () => {
                        // Clicking on version number takes us to that range. 
                        var clf = new analyze.NormChangeListFilter()
                            .setUser(user)
                            .setTimeRange(cluster.getTimeRange())
                        return new ShowNDeltaRange(clf);
                    }
                );


                // row.VerEnd = verEnd.valueOf();

                var tr = cluster.getTimeRange(); // local time 
                var trStart = bcl.TimeRange.roundToDay(tr.getStart());
                row.DayNumber = sortableDay(trStart);
                row.Day = trStart.toDateString();

                row.StartTime = tr.getStart().toLocaleTimeString();
                row.EndTime = tr.getEnd().toLocaleTimeString();

                row.TotalMinutes = Math.round(tr.getDurationSeconds() / 60);
                row.TotalDuration = bcl.TimeRange.prettyPrintSeconds(cluster.getTimeRange().getDurationSeconds());

                row.Distance = cluster.getTotalDist();
                row.HouseholdCount = cluster.getUniqueHouseholdCount(ctx.householder);

                // Record gaps between sessions
                if (!!lastLoc) {
                    row.GapDistanceKM = bcl.GeoHelper.getDistanceFromLatLonInKm(lastLoc, cluster.getGeoStart());
                } else {
                    row.GapDistanceKM = NaN;
                }
                if (!!lastTime) {
                    var timeGap = new bcl.TimeRange(
                        lastTime,
                        cluster.getTimeRange().getStart());
                    row.GapTimeMinutes = Math.round(timeGap.getDurationSeconds() / 60);
                } else {
                    row.GapTimeMinutes = NaN;
                }
                lastTime = cluster.getTimeRange().getEnd();
                lastLoc = cluster.getGeoEnd();

                totals.VoterCount += row.VoterCount;
                totals.HouseholdCount += row.HouseholdCount;
                totals.Distance += row.Distance;
                totals.TotalMinutes += row.TotalMinutes;

                table.writeRow(row);
            });
        });

        // Add total
        totals.TotalDuration = bcl.TimeRange.prettyPrintSeconds(totals.TotalMinutes * 60);
        table.writeRow(totals);
    }
}

// Each cell in the daily report. 
class DailyX {
    private _seconds: number = 0;

    private readonly _verRange: bcl.TimeRange;
    private readonly _user: string;

    public constructor(user: string, day: Date) {
        this._user = user;

        var start = rountToLocalStartDay(day);
        var end = new Date(start.getTime() + 60 * 60 * 24 * 1000 - 1); // last MS of the day 
        this._verRange = new bcl.TimeRange(start, end);
    }

    // Get a mode object that shows this cell in detail. 
    public getMode(): Mode {
        var clf = new analyze.NormChangeListFilter()
            .setUser(this._user)
            .setTimeRange(this._verRange); // Utc
        return new ShowSessionList(clf);
    }

    public build(cluster: analyze.Cluster): void {
        this._seconds += cluster.getDurationSeconds();
    }

    public getMinutes(): number {
        return Math.round(this._seconds / 60);
    }
    // Return value in minutes
    public toString(): string {
        return this.getMinutes().toString();
    }
}

// Show a 2d table, data[User][Day] = total minutes
// clicking on a cell takes to that session 
export class ShowDailyReport extends Mode {
    private _clf: analyze.NormChangeListFilter; // already has filter applied!

    public constructor(filter: analyze.NormChangeListFilter) {
        super();
        this._clf = filter;
    }

    public getDescription(): string {
        return "This shows 'active' usage (in minutes) per day for each user. Active usage is a span on consecutively uploading data. " +
            "Days are in YYYYMMDD format for easy sorting.";
    }


    public toHash(): string {
        return "show=daily;" + this._clf.toString();
    }

    public render(ctx: RenderContext): void {
        var cl = ctx.normChangelist;
        cl = cl.applyFilter(this._clf);

        // map of each user's daily activity. 
        // (per-User, per-day) --> DailyX
        var d = new bcl.Dict2d<DailyX>();

        var userCls: bcl.Dict<analyze.NormChangeList> = cl.filterByUser();
        userCls.forEach((user, cl2) => {
            var clusters = cl2.getClustering();
            clusters.forEach(cluster => {

                var tr: Date = cluster.getTimeRange().getStart();

                var trStart = rountToLocalStartDay(tr);
                //var trStart = bcl.TimeRange.roundToDay(tr);
                var day = sortableDay(trStart).toString();

                var status = d.get(user, day);
                if (!status) {
                    status = new DailyX(user, trStart);
                }
                status.build(cluster);
                d.add(user, day, status);
            });
        });

        // Sort alphabetically 
        // Columns are Dates. 
        // Rows are people. 

        var users = d.getKey1s();
        var days = d.getKey2s();
        days = days.sort();

        var columnNames = ["User"].concat(days);
        columnNames.push("Total");

        var tw = new TableWriter<any>(ctx.element, ctx, columnNames);

        var grandTotal = 0;
        var totalsPerUser = new bcl.Dict<number>();
        var totalsPerDay = new bcl.Dict<number>(); // total per-day 
        days.forEach(day => { totalsPerDay.add(day, 0); }); // initial add
        users.forEach(user => { totalsPerUser.add(user, 0); }); // initial add

        users.forEach(user => {
            var row: any = {};
            row.User = user;

            var totalPerUser = 0;
            days.forEach(day => {
                var cell = d.get(user, day);
                var min = 0;
                if (!cell) {
                    row[day] = "";
                } else {
                    min = cell.getMinutes();
                    row[day] = new ClickableValue(cell.toString(), () => cell.getMode());
                }

                totalPerUser += min;
                grandTotal += min;

                var t = totalsPerDay.get(day);
                t += min;
                totalsPerDay.add(day, t);

            });
            totalsPerUser.add(user, totalPerUser);
            row.Total = totalPerUser;

            tw.writeRow(row);
        });

        // Add a final row for Totals.
        var row: any = {};
        row.User = "TOTAL";
        days.forEach(day => {
            var t = totalsPerDay.get(day);
            row[day] = t;
        });
        row.Total = grandTotal;
        tw.writeRow(row);
    }
}

// Track group  of individual responses, per-question. 
class Responses {
    public Name: string; // ColumnName 

    // Histogram 
    // Answer --> Count of Answer.
    public _counts = new bcl.Dict<number>();


    // Build up a list of responses
    // Dictionary is Question --> Hist of Responses. 
    public static Build(normChangelist: analyze.NormChangeList): bcl.Dict<Responses> {
        var d = new bcl.Dict<Responses>();

        normChangelist.forEach(item => {
            item.forEach((columnName, newValue) => {

                var response = d.get(columnName);
                if (!response) {
                    response = new Responses();
                    response.Name = columnName;
                    d.add(columnName, response);
                }

                var c = response._counts.get(newValue);
                if (!c) {
                    c = 0;
                }
                c++;
                response._counts.add(newValue, c);
            });
        });
        return d;
    }
}


class ResponseTableRow {
    public Answer: string;
    public Count: number;
}
// Rows for the show=deltarange
class NDeltaRow {
    public Version: ClickableValue<string>; // Jump to delta
    public RecId: string;
    public HouseholdId: string;
    public User: string;
    public LocalTime: string;
    public App: string;
    public Contents: string;
}

// Show normalized range of deltas
export class ShowNDeltaRange extends Mode {
    private _clf: analyze.NormChangeListFilter; // already has filter applied!

    public constructor(filter: analyze.NormChangeListFilter) {
        super();
        this._clf = filter;
    }

    public getDescription(): string {
        return "This is an advanced view and shows a specific range of updates. " +
            "You can use this to drill into specific activity for sessions.";
    }


    public toHash(): string {
        return "show=ndeltarange;" + this._clf.toString();
    }

    public render(ctx: RenderContext): void {

        // Add an upload button
        {
            var p = $("<p>");
            // $$$
            //var btn = clickable(ctx, "View data by RecId", () => new ShowFlattenToRecId(this._clf))
            //p.append(btn);
            //ctx.element.append(p);
        }

        var cl = ctx.normChangelist;
        cl = cl.applyFilter(this._clf);

        var m = new MapHelper();
        m.init(cl);


        var placeNoteHere: JQuery<HTMLElement>;
        {
            var responses = Responses.Build(cl);

            var summaryHeading = $("<h3>").text("Response Summary");
            ctx.element.append(summaryHeading);

            placeNoteHere = $("<div>");
            ctx.element.append(placeNoteHere);

            responses.forEach((columnName, response) => {



                //ctx.element.append($("<p>").text(columnName));
                var panel = $("<div>").addClass("panel").addClass("panel-default");
                var panelH = $("<div>").addClass("panel-heading").text(columnName);
                var panelBody = $("<div>").addClass("panel-body");
                panel.append(panelH).append(panelBody);

                var tw = new TableWriter<ResponseTableRow>(panelBody, ctx);

                var total = 0;
                response._counts.forEach((answer, count) => {
                    var row = new ResponseTableRow();
                    row.Answer = answer;
                    row.Count = count;
                    total += count;
                    tw.writeRow(row);
                });

                var row = new ResponseTableRow();
                row.Answer = "TOTAL";
                row.Count = total;
                tw.writeRow(row);


                ctx.element.append(panel);
            });
        }

        ctx.element.append($("<h3>").text("Individual Answers"));

        var tw = new TableWriter<NDeltaRow>(ctx.element, ctx,
            ["Version", "RecId", "HouseholdId", "User", "LocalTime", "App", "Contents"]);

        var totalTime: bcl.TimeRange;
        var count = new bcl.HashCount();
        var countHH = new bcl.HashCount();
        cl.forEach((item) => {
            var row = new NDeltaRow();
            row.RecId = item.recId;
            row.HouseholdId = ctx.householder.getHHID(item.recId);
            row.User = item.getUser();
            row.App = item.getApp();

            count.Add(row.RecId);
            countHH.Add(row.HouseholdId);

            var verstr = item.delta.Version + "-" + item.deltaIdx;
            row.Version = new ClickableValue(verstr,
                () => new ShowDelta(item.delta.Version));

            row.LocalTime = item.xtimestamp.toLocaleString();

            if (!totalTime) {
                totalTime = new bcl.TimeRange(item.xtimestamp, item.xtimestamp);
            }
            totalTime.expandToInclude(item.xtimestamp);


            var x = "";
            item.forEach((columnName, newValue) => {
                x += columnName + "=" + newValue + "; ";
            });
            row.Contents = x;
            tw.writeRow(row);
        });

        var totalTimeStr = "0";
        if (!!totalTime) {
            totalTimeStr = totalTime.getDurationSecondsPretty();
        }
        var note = $("<p>").text(
            count.toString() + " total voters. " +
            countHH + " households. " +
            totalTimeStr + " total time.");
        placeNoteHere.append(note);

    }
}

// Rows for the show=deltarange
class DeltaRow {
    public Version: ClickableValue<number>; // Unique version number. 
    public User: string;
    public LocalTime: string;
    public App: string;
    public Contents: string;

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

    public getDescription(): string {
        return "This is an advanced view and shows a specific range of 'deltas'. You can use this to drill into specific activity for sessions.";
    }


    public toHash(): string {
        return "show=deltarange;" + this._clf.toString();
    }


    public render(ctx: RenderContext): void {



        // Add an upload button
        {
            var p = $("<p>");
            var btn = clickable(ctx, "View data by RecId", () => new ShowFlattenToRecId(this._clf))
            p.append(btn);

            ctx.element.append(p);
        }


        var cl = ctx.changelist;
        cl = cl.applyFilter(this._clf);

        var map = new MapHelper();
        var ncl = new analyze.NormChangeList(cl.getNormalizedDeltas());
        map.init(ncl);

        var tw = new TableWriter<DeltaRow>(ctx.element, ctx,
            ["Version", "User", "LocalTime", "App", "Contents"]);

        cl.forEachRawDelta((delta: trcSheet.IDeltaInfo) => {

            var row = new DeltaRow();
            row.User = delta.User;
            row.App = delta.App;
            row.Version = new ClickableValue(delta.Version,
                () => new ShowDelta(delta.Version));

            row.LocalTime = new Date(delta.Timestamp).toLocaleString();
            row.Contents = JSON.stringify(delta.Value);

            tw.writeRow(row);

        });

    }
}

// $$$ anomly list?  
// Clicks:
// - click on answer: show all versions that edited a specific cell (RecId,Column)
//       -   is that a more complex filter? 
// - click on RecId: show all versions that edited the recid. 
export class ShowFlattenToRecId extends Mode {
    private _clf: analyze.ChangelistFilter; // already has filter applied!

    public constructor(filter: analyze.ChangelistFilter) {
        super();
        this._clf = filter;
    }

    public getDescription(): string {
        return "This shows the information uploaded per each RecId.";
    }


    public toHash(): string {
        return "show=byrecid;" + this._clf.toString();
    }

    public render(ctx: RenderContext): void {

        var cl = ctx.changelist;
        cl = cl.applyFilter(this._clf);

        var m = new MapHelper();
        var ncl = new analyze.NormChangeList(cl.getNormalizedDeltas());
        m.init(ncl);

        // $$$ Add click support?
        var sc = cl.flattenByRecId();
        var r = new trchtml.RenderSheet("contents", sc);
        r.render();
    }
}

