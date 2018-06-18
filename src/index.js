import './css/main.scss';
import '../helpers/string-helpers';
import { createBrowseCategory, createTopicKey } from './components/BrowseButtons';
import { createResultsContainer, createResultItem, filterResults } from './components/ResultItems'; 
import tippy from 'tippy.js';
   
(function(){     
/* global d3 */
"use strict";  
    const groupId = '2127948';
    const tooltipKey = '1kK8LHgzaSt0zC1J8j3THq8Hgu_kEF-TGLry_U-6u9WA';
    var controller = { 
        gateCheck: 0,
        init(useLocal){ // pass in true to bypass API and use local data
            window.RFFApp.model.tooltipPromise = new Promise((resolve, reject) => {
                window.RFFApp.model.resolveTooltip = resolve;
                window.RFFApp.model.rejectTooltip = reject;
            });
            window.RFFApp.model.topicButtonPromise = new Promise((resolve) => {
                window.RFFApp.model.resolveTopicButtons = resolve;
            });
            this.returnCollectionTooltipTitles();
            this.getZoteroCollections(useLocal);
            this.getZoteroItems(useLocal);
            Promise.all([window.RFFApp.model.tooltipPromise, window.RFFApp.model.topicButtonPromise]).then(values => {
                this.setCollectionTooltips(values[0]);
            });
            
        },
        setCollectionTooltips(values){
            document.querySelectorAll('.browse-buttons > div').forEach(btn => {
                var match = values.find(d => d.key === btn.dataset.collection);
                if ( match !== undefined ){
                    btn.setAttribute('title', match.title);
                    tippy.one(btn, {
                        theme:'RFF',
                        arrow: true
                    });
                }
            });
        },
        childrenify(data){
            console.log(data); 
            data.forEach(d => {
                if ( d.data.parentCollection !== false && d.meta.numItems > 0 ) { // ie has a parent and has items (exclude empty subcollections)
                    let match = data.find(collection => collection.key === d.data.parentCollection);
                    if ( match !== undefined ){
                        match.children = match.children || [];
                        match.children.push(d);
                    }
                }
            }); 
            return data; 
 
        },
        returnCollectionTooltipTitles(){ // gets data from Google Sheet, converst rows to key-value pairs, nests the data
                              // as specified by the config object, and creates array of summarized data at different
                              // nesting levels                                
                d3.json('https://sheets.googleapis.com/v4/spreadsheets/' + tooltipKey + '/values/Sheet1?key=AIzaSyDD3W5wJeJF2esffZMQxNtEl9tt-OfgSq4', (error,data) => { 
                    if (error) {
                        window.RFFApp.model.rejectTooltip(error);
                        throw error;
                    }
                    var values = data.values;
                    window.RFFApp.model.resolveTooltip(this.returnKeyValues(values)); 
                });
        },
        returnKeyValues(values, coerce){
            return values.slice(1).map(row => row.reduce((acc, cur, i) => { 
            
        
                acc[values[0][i]] = coerce === true ? isNaN(+cur) || cur === '' ? cur : +cur : cur; 
                return acc;
        
                                                  // test for empty strings before coercing bc +'' => 0
            }, {}));
            
           
        },
        nestPrelim(nestByArray){
            // recursive  nesting function, prelim step to recursiveNest
            return nestByArray.reduce((acc, cur) => {
                if (typeof cur !== 'string' && typeof cur !== 'function' ) { throw 'each nestBy item must be a string or function'; }
                var rtn;
                if ( typeof cur === 'string' ){
                    rtn = acc.key(function(d){
                        return d[cur];
                    });    
                }
                if ( typeof cur === 'function' ){
                    rtn = acc.key(function(d){
                        return cur(d);
                    });
                }
                
                return rtn;
            }, d3.nest());
        },
        recursiveNest(values, nestBy, nestType = 'series'){
            
            // nestBy = string or array of field(s) to nest by, or a custom function, or an array of strings or functions;
                      
            if ( typeof nestBy === 'string' || typeof nestBy === 'function' ) { // ie only one nestBy field or funciton
                this.nestByArray = [nestBy];
            } else {
                if (!Array.isArray(nestBy)) { throw 'nestBy variable must be a string, function, or array of strings or functions'; }
                this.nestByArray = nestBy;
            }
            var prelim = this.nestPrelim(this.nestByArray);
            
            if ( nestType === 'object' ){
                return prelim
                    .object(values);
            } else {
                return prelim
                    .entries(values);
            }
        },
        getZoteroCollections(useLocal){ // IMPORTANT this will break if # of collections exceeds 100. will needs to 
                                // implement strategy use for getting items

            
            if ( useLocal ){
                d3.json('data/zoteroCollections-6-18-18.json', (error,data) => {
                    if ( error ) {
                        throw error;
                    }
                    model.collections = this.childrenify(data);
                    console.log('increment gateCheck from get collections');
                    this.gateCheck++;
                    view.init();
                });
                return;
            }
            var promise = new Promise((resolve,reject) => {
                d3.json('https://api.zotero.org/groups/' + groupId + '/collections?limit=100', (error,data) => {
                    if (error) {
                        reject(error);
                        throw error;
                    }
                    console.log(JSON.stringify(data));
                    model.collections = this.childrenify(data);
                   // model.collections = this.recursiveNest(data, [d => d.data.parentCollection, d => d.data.parentCollection]);
                    resolve(model.collections); 
                });
            });
            promise.then(data => {  
                console.log(data);
                
                
                console.log('increment gateCheck from get collections');
                this.gateCheck++;
                view.init();
            }); 
        }, 
        getZoteroItems(useLocal){

            if ( useLocal ){
                d3.json('data/zoteroItems-6-18-18.json', (error,data) => {
                    if ( error ) {
                        throw error;
                    }
                    model.zoteroItems = data;
                    this.parseZoteroItemDates();
                    console.log('increment gateCheck from get items');
                    this.gateCheck++;
                    view.init();
                });
                return;
            }

            var initialItemsPromises = [],
                subsequentItemsPromises = [],
                initialMax = 9; // last known number of times the API must be hit to get all results. 100 returned at a time,
                                // so 3 would get up to 300 hundred. time of coding total was 284; when the toal increases
                                // the code below will make addition API calls
            
            function constructPromise(i){
                var promise = new Promise((resolve,reject) => { // using d3.request instead of .json to have access to the 
                                                                // response headers. 'Total-Results', in partucular
                    d3.request('https://api.zotero.org/groups/' + groupId + '/items/top?include=data,bib&limit=100&start=' + ( i * 100 ), (error,xhr) => { 
                        if (error) {
                            reject(error);
                            throw error;
                        }
                        console.log(xhr);
                        resolve({
                            total: +xhr.getResponseHeader('Total-Results'), // + operand coerces to number
                            data: JSON.parse(xhr.responseText)
                        }); 
                        
                    });
                });
                return promise;     
            }

            for ( let i = 0; i < initialMax; i++ ){
                initialItemsPromises.push(constructPromise(i));
            }
            Promise.race(initialItemsPromises).then(value => {
                console.log(value);
                if ( value.total > initialMax ) {
                    for ( let i = initialMax; i < Math.ceil(value.total / 100); i++ ){
                        subsequentItemsPromises.push(constructPromise(i));
                    }
                    Promise.all([...initialItemsPromises,...subsequentItemsPromises]).then((values) => {
                        window.dateStrings = [];
                        console.log(values);
                        values.forEach(value => { 
                            //console.log(value.data.date);
                            model.zoteroItems.push(...value.data);
                        });
                        console.log(JSON.stringify(model.zoteroItems));
                        this.parseZoteroItemDates();
                        this.gateCheck++;
                        view.init();
                    });
                } else {
                    Promise.all(initialItemsPromises).then((values) => {
                        console.log(values);
                        values.forEach(value => {
                            model.zoteroItems.push(...value.data);
                        });
                        this.parseZoteroItemDates(); 
                        this.gateCeck++;
                        view.init();
                    });        
                }
                
            });
            
        },
        parseZoteroItemDates(){
            model.zoteroItems.forEach(d => { // TODO  way too repetitive of above
              
                var parsedDates = this.getDatesFromString(d.data.date);
                d.data.dateString = parsedDates.display;
                d.data.dateValue = parsedDates.value;
            }); 
            model.zoteroItems.sort((a,b) => d3.descending(a.data.dateValue, b.data.dateValue)); 
      },
        getCollectionItems(collectionKey){
            console.log(collectionKey);
            var collection = model.collections.find(c => c.key === collectionKey );
            console.log(collection);
            var collectionItems = model.zoteroItems.filter(z => z.data.collections.indexOf(collectionKey) !== -1);
            console.log(collectionItems);
            var synthesisItems = []; 
            if ( collection.children ) {
                collection.children.forEach(child => { // to do make more DRY
                    var matches = model.zoteroItems.filter(z => z.data.collections.indexOf(child.key) !== -1);
                    matches.forEach(match => {
                        match.synthesisType = child.data.name;
                    });
                    synthesisItems.push(...matches);
                });
            }
            createResultsContainer.call(view);
            filterResults.call(view, collectionItems, controller);
            view.filterSynthesisResults(synthesisItems);
            /*var promise = new Promise((resolve,reject) => {
                d3.text('https://api.zotero.org/groups/' + groupId + '/collections/' + collectionKey + '/items?format=keys', (error,text) => {
                    if (error) {
                        reject(error);
                        throw error;
                    }
                    resolve(text); 
                });
            });
            promise.then(text => {
                var keys = text.split('\n'); // API response is text of keys with newline between
                if ( keys[keys.length - 1] === '' ){ // the last item seems to be an empty string (newline at end)
                                                     // this checks for that and removes it (pop()) if true
                    keys.pop();
                }
            });*/
        },
        getDatesFromString(string){
       //     console.log(string);
            var value = new Date(1776,3,4), // so that pubs without dates are sorted properly (null == 0 == 1970);
                display = '',
                matchTypes = {
                    forthcoming:/forthcoming/,
                    yyyy:       /^(\d{4})$/,
                    yyyymmdd:   /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, 
                    monthddyyyy:/^(\w+)\.* *(\d{1,2}), *(\d{4})/,
                    monthyyyy:  /^(\w+)\.* (\d{4})/,
                    yyyymm:     /^(\d{4})[-/](\d{1,2})$/,
                    mmddyyyy:   /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/,
                    yyyyyyyy:   /^(\d{4})[-–—]\d{4}/,
                    yyyymonthdd:/^(\d{4}) *(\w+)\.* *(\d{1,2})/ 
            };
            
            function checkMonth(str){
                if ( months[str] !== undefined && isNaN(months[str]) ) {
                    return months[str];
                }
                return str;
            }
            
            var months = {
                '0': 'January',
                '1': 'February',
                '2': 'March',
                '3': 'April',
                '4': 'May',
                '5': 'June',
                '6': 'July',
                '7': 'August',
                '8': 'September',
                '9': 'October',
               '10': 'November',
               '11': 'December',
                'January':  0,
                'February': 1,
                'March':    2,
                'April':    3,
                'May':      4,
                'June':     5,
                'July':     6,
                'August':   7,
                'September':8,
                'October':  9,
                'November': 10,
                'December': 11,
                'Winter':   11,
                'Spring':   2,
                'Summer':   5,
                'Fall':     8,
                'Autumn':   8,
                'Jan': 'January',
                'Feb': 'February',
                'Mar': 'March',
                'Apr': 'April',
                'Jun': 'June',
                'Jul': 'July',
                'Aug': 'August',
                'Sep': 'September',
                'Sept': 'September',
                'Oct': 'October',
                'Nov': 'Novemeber',
                'Dec': 'December'
            };
            for (var type in matchTypes) {
                if ( matchTypes.hasOwnProperty(type) && string !== undefined ) {
                    let match = string.match(matchTypes[type]);      
                    if ( match !== null ) {
                      
                        switch ( type ) {
                            case 'yyyy':
                                display = string;
                                value = new Date(+match[1],0,1);
                                break;
                            case 'yyyymmdd':
                                display = `${months[(+match[2] - 1).toString()]} ${+match[3]}, ${match[1]}`; 
                                value = new Date(+match[1], +match[2] - 1, +match[3]);
                                break;
                            case 'monthddyyyy':
                                display = `${checkMonth(match[1])} ${+match[2]}, ${match[3]}`;
                                value = new Date(+match[3], months[checkMonth(match[1])], +match[2]); 
                                break;
                            case 'monthyyyy':
                                display = `${checkMonth(match[1])} ${match[2]}`;
                                value = new Date(+match[2], months[checkMonth(match[1])], 1); 
                                break;
                            case 'yyyymm':
                                display = months[(+match[2] - 1)] + ' ' + match[1];
                                value = new Date(+match[1], +match[2] - 1, 1);
                                break;
                            case 'mmddyyyy':
                                display = `${months[(+match[1] - 1)]} ${+match[2]}, ${match[3]}`; 
                                value = new Date(+match[3], +match[1] - 1, +match[2]);
                                break;
                            case 'yyyyyyyy':
                                display = string.replace('-','—').replace('-','–');
                                value = new Date(+match[1],0,1);
                                break;
                            case 'yyyymonthdd':
                                display = `${checkMonth(match[2])} ${+match[3]}, ${match[1]}`;
                                value = new Date(+match[1], months[checkMonth(match[2])], +match[3]); 
                                break;
                            case 'forthcoming':
                                display =  'forthcoming';
                                value =  new Date();
                                break;
                        } 
                    }
                }
            }  
            return {
                value,
                display
            };
        },
        copyBibText(){
          // this = element
          var bibEntry = this.parentNode.querySelector('.bib-container');
         // bibEntry.focus();
          bibEntry.select();
          try {
            var successful = document.execCommand('copy');
            var msg = successful ? 'successful' : 'unsuccessful';
            console.log('Copying text command was ' + msg);
            if ( successful ) {
                alert('Bibliographical entry copied to clipboard');
            }
          } catch (err) {
            console.log('Oops, unable to copy');
          }

        }  


    }; 
 
    var model = {
        zoteroItems: []   
    }; 
    
    var view = { 
        init(){
            console.log(controller.gateCheck);
            if ( controller.gateCheck < 2 ){
                //console.log('return');
                return;
            }
            console.log('READY!');
            console.log(model.zoteroItems);
            this.renderTopicButtons();
            console.log(model.collections);
            var initialCategory = document.querySelector('.browse-buttons div.active').dataset.collection;
            controller.getCollectionItems(initialCategory);
        },
        renderTopicButtons(){
            var section = document.getElementById('browse-buttons-container');
            var categories = model.collections.filter(d => d.data.parentCollection === false).sort((a,b) => d3.ascending(a.data.name, b.data.name));
            console.log(categories);
            //model.collections.false.sort((a,b) => d3.ascending(a.data.name, b.data.name)); // 'false' key => top-lvel categories
            categories.filter(d => d.children !== undefined).forEach(function(d,i){
                section.appendChild(createBrowseCategory(d,i,true));
            });
            categories.filter(d => d.children === undefined).forEach(function(d,i){
                section.appendChild(createBrowseCategory(d,i,false));
            });
            window.RFFApp.model.resolveTopicButtons(true);
            this.renderShowAllButton();
        },
        renderShowAllButton(){
            var showAll = d3.select('.browse-buttons.uncategorized')  // should be in the view module
                .append('div')
                .classed('button button--tertiary show-all',true)
                .on('click', function(){
                    d3.selectAll('.browse-buttons .button')  // not DRY; need to bring out into fn; browsebuttons 
                                                             // do the same thing
                        .classed('active', false);
                    d3.select(this)
                        .classed('active', true);
                    filterResults.call(view, null, controller);
                    view.filterSynthesisResults.call(view,[]);
                });
            showAll     
                .append('span')
                .text('Show all');
            createTopicKey();
        },
        showDetails(listItem){
            var $listItem = d3.select(listItem);
            $listItem
                .classed('show-details', !$listItem.classed('show-details'));
        },
        filterSynthesisResults(matches){ // needs to be more DRY re: code above
            console.log(matches);
            var items = d3.select('#synthesis-results ul').selectAll('.list-item')
                .data(matches, d => d.data.key);
                console.log(items);
            items.exit()
                .classed('entered',false)
                .classed('exiting', true)
                .transition(1500).remove();

            var entering = items.enter()
                .append('li')
                .attr('id', d => d.key)
                .attr('class', (d,i) => ( d.synthesisType.cleanString() || d.data.itemType )  + ' index-' + i + ( d.data.institution === 'RFF' || d.data.institution === 'Resources for the Future' ? ' RFF' : ''))
                .classed('RFF', true)
                .classed('entering', true)
                .classed('list-item', true)
                .html(d => createResultItem(d))
                .on('click', function(){
                    window.open('./pdf/' + this.id + '.pdf', '_blank');
                });

            setTimeout(function(){
                entering.classed('entering',false);    
            });

            this.synthesisItems = entering.merge(items); 

            d3.selectAll('.item-title-link')
                .on('click', function(){
                    d3.event.preventDefault();     
                });

        }
    };
    window.RFFApp = {
        controller,
        model 
    };
    controller.init(true); // pass in `true` to use local snapshot instead of API
     
}()); // end IIFE 