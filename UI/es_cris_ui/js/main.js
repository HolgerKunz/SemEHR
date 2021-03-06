(function($){
    var _invitationId = null;
    var _users = ['hepc_hw', 'hepc_gt', 'hepc_km'];
    var _user_feedback = {};

    var __es_need_login = false;
    var _es_client = null;
    var __es_server_url = "http://localhost:9200";
    var __es_index = "hepcpos_300"; //epr_documents_bioyodie
    var __es_type = "patient"; //semantic_anns
    var __es_concept_type = "ctx_concept";
    var __es_fulltext_index = "hepcpos_300";
    var __es_fulltext_type = "eprdoc";
    var _display_attrs = ["src_table", "fulltext"];
    var _full_text_attr = 'fulltext';
    var _fdid = 'eprid';

    var _pageNum = 0;
    var _pageSize = 1;
    var _entityPageSize = 10000;
    var _resultSize = 0;
    var _queryObj = null;
    var _currentDocMentions = null;

    var _umlsToHPO = {};

    var _context_concepts = null;
    var _cid2type = {};

    function initESClient(){
        if (__es_need_login){
            easyLogin();
        }else{
            _es_client = new $.es.Client({
                hosts: __es_server_url
            });
            _es_client.ping({
                requestTimeout: 30000,
            }, function (error) {
                if (error) {
                    console.error('elasticsearch cluster is down!');
                } else {
                    console.log('All is well');
                }
            });
        }
    }

    function easyLogin(){
        swal.setDefaults({
            confirmButtonText: 'Next &rarr;',
            showCancelButton: true,
            animation: false,
            progressSteps: ['1', '2']
        })

        var steps = [
            {
                title: 'Login',
                text: 'name',
                input: 'text',
            },
            {
                title: 'Login',
                text: 'password',
                input: 'password',
                confirmButtonText: 'login'
            }
        ]

        swal.queue(steps).then(function (result) {
            swal.resetDefaults();
            swal('login...');
            swal.showLoading();
            _es_client = $.es.Client({
                host: [
                    {
                        host: __es_server_url,
                        auth: result[0] + ':' + result[1],
                        protocol: 'http',
                        port: 9200
                    }
                ]
            });
            _es_client.ping({
                requestTimeout: 30000,
            }, function (error) {
                if (error) {
                    swal({
                        title: 'something is wrong!',
                        confirmButtonText: 'retry',
                        showCancelButton: true
                    }).then(function(){
                        easyLogin();
                    });
                    console.error('elasticsearch cluster is down!');
                } else {
                    swal({
                        title: 'Welcome back, ' + result[0] + "!",
                        confirmButtonText: 'ok',
                    });
                    console.log('All is well');
                }
            });
        }, function () {
            swal.resetDefaults()
        })
    }

    function userLogin(){
        swal.setDefaults({
            confirmButtonText: 'Next &rarr;',
            showCancelButton: true,
            animation: false,
            progressSteps: ['1']
        })

        var steps = [
            {
                title: 'Login',
                text: 'name',
                input: 'text',
                confirmButtonText: 'login'
            }
        ]

        swal.queue(steps).then(function (result) {
            swal.resetDefaults();
            _invitationId = result[0];
            var matched = false;
            for(var i=0;i<_users.length;i++){
                if (_users[i] == _invitationId){
                    matched = true;
                    break;
                }
            }
            if (matched){
                swal('welcome ' + _invitationId + '!');
                $('#primaryNav').html('<span>' + _invitationId + '</span>');
                initESClient();
                // read user feedbacks from the server
                getUserFeedback();
            }else{
                _invitationId = null;
                swal('invalid user!');
            }
        });
    }

    function getUserFeedback(){
        qbb.inf.getEvalResult(_invitationId, function(s){
            _user_feedback = $.parseJSON(s);
        });
    }

    function search(queryObj){
        var termMaps = queryObj["terms"];
        var query_str = queryObj["query"];
        var entity_id = queryObj["entity"]
        var query_body = {
            from: _pageNum * _entityPageSize,
            size: _entityPageSize,
            query: {bool: {must:[]}},
            highlight:{
                fields: {_all:{}}
            }
        };
        getUserFeedback();
        if (termMaps!=null){
            var bq = query_body["query"]["bool"]["must"];
            for (var hpo in termMaps){
                var shouldQuery = [];
                for (var idx in termMaps[hpo]) {
                    shouldQuery.push({"match": {"_all": termMaps[hpo][idx]}});
                }
                bq.push({bool: {should: shouldQuery}});
            }
            bq.minimum_should_match = 1;
        }
        if (query_str!=null && query_str.trim().length > 0){
            query_body["query"]["bool"]["must"].push( {match: {"_all": query_str}} );
        }
        //query_body["query"]["bool"]["must"].push( {match: {"id": entity_id}} );
        //console.log(query_body);
        swal('searching...')
        _es_client.search({
            index: __es_index,
            type: __es_type,
            body: query_body
        }).then(function (resp) {
            swal.resetDefaults();
            swal('analysing...');
            var hits = resp.hits.hits;
            //console.log(resp.hits);
            if (hits.length > 0) {
                //do filter
                var toFilter = [];
                if ($('#chk_pos').is(":checked")){
                    toFilter = toFilter.concat(hepcpos_100);
                }
                if ($('#chk_neg').is(":checked")){
                    toFilter = toFilter.concat(hepcneg_100);
                }
                if ($('#chk_unknown').is(":checked")){
                    toFilter = toFilter.concat(hepcunknown_100);
                }
                var filtered = [];
                for (var i=0;i<hits.length;i++){
                    if ($.inArray(hits[i]['_id'], toFilter)>=0){
                        filtered.push(hits[i]);
                    }
                }

                console.log("=>>" + filtered.length)
                summaris_cohort(filtered);
            }else{
                $('#sumTermDiv').html('no records found');
            }
            swal.close();
            // _resultSize = resp.hits.total;
            // renderPageInfo();
            // render_results(hits, termMaps);
        }, function (err) {
            console.trace(err.message);
        });
    }

    function getTermDesc(umls_term, cb){
        _es_client.search({
            index: __es_index,
            type: __es_concept_type,
            q: umls_term
        }).then(function (resp) {
            var hits = resp.hits.hits;
            if (hits.length > 0 && cb)
                cb(hits[0]);
        }, function (err) {
            console.trace(err.message);
        });
    }

    function summaris_cohort(entities){
        $('#entitySummHeader').css("visibility", "visible");
        $('#dataRowDiv').show();
        $('#entitySumm').css("visibility", "visible");
        var summ_term = null;
        var cuis = [];
        if (Object.keys(_queryObj["terms"]).length > 0){
            for(var hp in _queryObj["terms"]) {
                summ_term = hp;
                cuis = cuis.concat(_queryObj["terms"][hp]);
            }
        }else {
            var keywords = _queryObj["query"].split(" ");
            for (var i=0;i<keywords.length;i++) {
                if (keywords[i].match(/C\d{5,}/ig)){
                    summ_term = keywords[i]
                    cuis.push(summ_term);
                }
            }
        }
        if (summ_term != null) {
            $('#sumTermDiv').html('<span id="termSumText">' + summ_term + '</span>');
            getTermDesc(cuis.join(' '), function(s){
                $('#termSumText').html(s['_source']['prefLabel'] + 
                    // "(" + summ_term + ") " + 
                    " matched " + entities.length + " patients");
            });
        }else{
            sweetAlert('concept term not available')
        }

        _context_concepts = {
            'mentions': {}, 
            'freqs':{},
            'typed': {}, 
            'entityMentions': {},
            'typedFreqs': {}
        };
        entities = entities.sort(function(a, b){
            return a['_id'] - b['_id'];
        });
        for (var i=0;i<entities.length;i++){
            summarise_entity_result(entities[i], cuis);
        }

        var ctx_concepts = _context_concepts.mentions;
        for(var c in ctx_concepts) {
            _es_client.get({
                index: __es_index,
                type: __es_concept_type,
                id: c
            }).then(function (resp) {
                //console.log(resp);
                _context_concepts['typed'][resp['_id']] = resp;
                if (Object.keys(_context_concepts['typed']).length == Object.keys(_context_concepts['mentions']).length){
                    var cid2type = {};
                    // do typed analysis
                    for (var cid in _context_concepts['typed']){
                        var t = _context_concepts['typed'][cid];
                        if (t['_source']['experiencer'] == 'Patient'){
                            if (t['_source']['temporality'] != "Recent"){
                                //_context_concepts['hisM'].push(t);
                                cid2type[cid] = 'hisM';
                            }else{
                                if (t['_source']['negation'] == "Negated"){
                                    //_context_concepts['negM'].push(t);
                                    cid2type[cid] = 'negM';
                                }else{
                                    //_context_concepts['posM'].push(t);
                                    cid2type[cid] = 'posM';
                                }
                            }
                        }else{
                            //_context_concepts['otherM'].push(t);
                            cid2type[cid] = 'otherM';
                        }
                    }
                    _cid2type = cid2type;

                    renderSumTable(true);

                    $('#sumTermDiv').append('<span class="btnExport">export tsv</span>');
                    $('.btnExport').click(function(){
                        export_tsv();
                    });
                }
            }, function (err) {
                console.trace(err.message);
            });
        }
        //console.log(ctx_concepts);

        $('.sum').click(function(){
            if ($(this).html() == '-')
                return;
            var entityId = $(this).attr('entityId');
            if ($(this).hasClass('allM')){
                //console.log(_context_concepts['entityMentions'][entityId]['all']);
                show_matched_docs(_context_concepts['entityMentions'][entityId]['all']);
            }else if ($(this).hasClass('posM')){
                var ctx_concept = _context_concepts['entityMentions'][entityId]['posM'];
                show_matched_docs(ctx_concept);
            }else if ($(this).hasClass('negM')){
                var ctx_concept = _context_concepts['entityMentions'][entityId]['negM'];
                show_matched_docs(ctx_concept);
            }else if ($(this).hasClass('hisM')){
                var ctx_concept = _context_concepts['entityMentions'][entityId]['hisM'];
                show_matched_docs(ctx_concept);
            }else if ($(this).hasClass('otherM')){
                var ctx_concept = _context_concepts['entityMentions'][entityId]['otherM'];
                show_matched_docs(ctx_concept);
            }
            $('.sum').parent().removeClass('selected');
            $(this).parent().addClass('selected');
        });
    }

    function renderSumTable(inital){
        var cid2type = _cid2type;
        for(var entityId in _context_concepts.freqs){
            var row = '#r' + entityId;
            var entityMention = _context_concepts.entityMentions[entityId];
            var typedFreq = {'otherM': 0, 'posM': 0, 'negM':0, 'hisM': 0}
            
            var cc2freq = _context_concepts.freqs[entityId];
            for(var cc in cc2freq){
                //entityMention['all'].push(cc);
                if (inital){
                    entityMention[cid2type[cc]].push(entityMention['all'][cc]);
                }
                typedFreq[cid2type[cc]] += cc2freq[cc];
            }
            //_context_concepts.entityMentions[entityId] = entityMention;
            _context_concepts.typedFreqs[entityId] = typedFreq;

            if (typedFreq['posM'] > 0){
                var fbr = fbNumbers(entityMention, 'posM');
                $(row).find('.posM').html(typedFreq['posM'] + 
                    ' [<span class="num correct">' + fbr['correct'] + '</span>' +
                    '<span class="num wrong">' + fbr['wrong'] + '</span>]');
            }
                
            if (typedFreq['negM'] > 0){
                var fbr = fbNumbers(entityMention, 'negM');
                $(row).find('.negM').html(typedFreq['negM'] + 
                    ' [<span class="num correct">' + fbr['correct'] + '</span>' +
                    '<span class="num wrong">' + fbr['wrong'] + '</span>]');
            }
            
            if (typedFreq['otherM'] > 0){
                var fbr = fbNumbers(entityMention, 'otherM');
                $(row).find('.otherM').html(typedFreq['otherM'] + 
                    ' [<span class="num correct">' + fbr['correct'] + '</span>' +
                    '<span class="num wrong">' + fbr['wrong'] + '</span>]');
            }

            if (typedFreq['hisM'] > 0){
                var fbr = fbNumbers(entityMention, 'hisM');
                $(row).find('.hisM').html(typedFreq['hisM'] + 
                    ' [<span class="num correct">' + fbr['correct'] + '</span>' +
                    '<span class="num wrong">' + fbr['wrong'] + '</span>]');
            }
        }
    }

    function fbNumbers(entityMention, type){
        var mentions = entityMention[type];
        var c = 0;
        var w = 0;
        for (var i=0;i<mentions.length;i++){
            for (var did in mentions[i]){
                for(var j=0;j<mentions[i][did].length;j++){
                    var id = 'd' + did + "_s" + mentions[i][did][j]['offset_start'] + "_e" + mentions[i][did][j]['offset_end'];
                    if (id in _user_feedback){
                        if (_user_feedback[id] == type)
                            c += 1;
                        else
                            w += 1;
                    }
                }
            }
        }
        return {'correct':c, 'wrong':w};
    }

    function export_tsv(){
        var w = window.open();
        var html = '';
        var header = ['Patient ID', 'Total Mentions', 'Positive Mentions', 'History/hypothetical Mentions', 'Negative Mentions', 'Other Experiencers'];
        html += header.join('\t') + '\n';
        for(var entityId in _context_concepts.freqs){
            var row = [entityId];
            var entityMention = _context_concepts.entityMentions[entityId];
            var typedFreq = {'otherM': 0, 'posM': 0, 'negM':0, 'hisM': 0}
            var cc2freq = _context_concepts.freqs[entityId];
            var allM = 0;
            for(var cc in cc2freq){
                typedFreq[_cid2type[cc]] += cc2freq[cc];
                allM += cc2freq[cc];
            }
            row.push(allM);  
            row.push(typedFreq['posM']);            
            row.push(typedFreq['hisM']);
            row.push(typedFreq['negM']);
            row.push(typedFreq['otherM']);
            html += row.join('\t') + '\n';
        }
        html = '<pre>' + html + '</pre>';
        $(w.document.body).html(html);
    }

    /**
     * summarise the entity centric concept matchings
     *
     * @param entityObj
     */
    function summarise_entity_result(entityObj, cuis){
        $('#entitySumm').append($('#sumRowTemplate').html());
        var row = $('#entitySumm .sumRow:last');
        $(row).attr('id', "r" + entityObj['_id']);
        $(row).find('.patientId').html(entityObj['_id']);
        var ctx_concepts = {};
        var entityMention = {'otherM': [], 'posM': [], 'negM':[], 'hisM': [], 'all':[]};        
        _context_concepts.entityMentions[entityObj['_id']] = entityMention;
        var ctx_to_freq = {};

        var totalM = 0;
        var cui_check_str = cuis.join();

        var duplicate_detect_obj = {};
        for(var i=0;i<entityObj['_source']['anns'].length;i++){
            var ann = entityObj['_source']['anns'][i];
            if (cui_check_str.indexOf(ann['CUI']) >= 0){
                var cc = ann['contexted_concept'];
                var doc2pos = {};
                //ctx_to_freq[cc] = cc in ctx_to_freq ? ctx_to_freq[cc] + ann['appearances'].length : ann['appearances'].length;
                for (var j=0;j<ann['appearances'].length;j++){
                    var key = cc + ' ' + ann['appearances'][j][_fdid] + ' ' + ann['appearances'][j]['offset_start'] + ' ' + ann['appearances'][j]['offset_end'];
                    if (key in duplicate_detect_obj){
                        break;
                    }else{
                        duplicate_detect_obj[key] = 1;
                        totalM += ann['appearances'].length;
                        ctx_to_freq[cc] = cc in ctx_to_freq ? ctx_to_freq[cc] + 1 : 1;
                    }
                    if (ann['appearances'][j][_fdid] in doc2pos){
                        doc2pos[ann['appearances'][j][_fdid]].push(ann['appearances'][j]);
                    }else{
                        doc2pos[ann['appearances'][j][_fdid]] = [ann['appearances'][j]];
                    }
                }
                if (Object.keys(doc2pos).length > 0){
                    if (cc in ctx_concepts){
                        var exist_doc2pos = ctx_concepts[cc];
                        for (var d in doc2pos){
                            if (d in exist_doc2pos){
                                exist_doc2pos[d] = exist_doc2pos[d].concat(doc2pos[d]);
                            }else{
                                exist_doc2pos[d] = doc2pos[d];
                            }
                        }
                    }else{
                        ctx_concepts[cc] = doc2pos;
                    }
                }                
            }
        }
        //console.log(ctx_concepts);
        entityMention.all = ctx_concepts;
        _context_concepts.freqs[entityObj['_id']] = ctx_to_freq;
        $.extend(_context_concepts.mentions, ctx_concepts);

        $('.sum').click(function(){
            var entityId = $(this).attr('entityId');
            if ($(this).hasClass('allM')){
                console.log(_context_concepts['entityMentions'][entityId]['all']);
                show_matched_docs(_context_concepts['entityMentions'][entityId]['all']);
            }else if ($(this).hasClass('posM')){
                var ctx_concept = _context_concepts['entityMentions'][entityId]['posM'];
                show_matched_docs(ctx_concept);
            }else if ($(this).hasClass('negM')){
                var ctx_concept = _context_concepts['entityMentions'][entityId]['negM'];
                show_matched_docs(ctx_concept);
            }else if ($(this).hasClass('hisM')){
                var ctx_concept = _context_concepts['entityMentions'][entityId]['hisM'];
                show_matched_docs(ctx_concept);
            }else if ($(this).hasClass('otherM')){
                var ctx_concept = _context_concepts['entityMentions'][entityId]['otherM'];
                show_matched_docs(ctx_concept);
            }
            $('.sum').parent().removeClass('selected');
            $(this).parent().addClass('selected');
        });
    }

    /**
     * summarise the entity centric concept matchings
     *
     * @param entityObj
     */
    function summarise_entity_result(entityObj, cuis){
        $('#entitySumm').append($('#sumRowTemplate').html());
        var row = $('#entitySumm .sumRow:last');
        $(row).attr('id', "r" + entityObj['_id']);
        $(row).find('.patientId').html(entityObj['_id']);
        var ctx_concepts = {};
        var entityMention = {'otherM': [], 'posM': [], 'negM':[], 'hisM': [], 'all':[]};        
        _context_concepts.entityMentions[entityObj['_id']] = entityMention;
        var ctx_to_freq = {};

        var totalM = 0;
        var cui_check_str = cuis.join();

        var duplicate_detect_obj = {};
        for(var i=0;i<entityObj['_source']['anns'].length;i++){
            var ann = entityObj['_source']['anns'][i];
            if (cui_check_str.indexOf(ann['CUI']) >= 0){
                var cc = ann['contexted_concept'];
                var doc2pos = {};
                totalM += ann['appearances'].length;
                //ctx_to_freq[cc] = cc in ctx_to_freq ? ctx_to_freq[cc] + ann['appearances'].length : ann['appearances'].length;
                for (var j=0;j<ann['appearances'].length;j++){
                    var key = cc + ' ' + ann['appearances'][j][_fdid] + ' ' + ann['appearances'][j]['offset_start'] + ' ' + ann['appearances'][j]['offset_end'];
                    if (key in duplicate_detect_obj){
                        break;
                    }else{
                        duplicate_detect_obj[key] = 1;
                        ctx_to_freq[cc] = cc in ctx_to_freq ? ctx_to_freq[cc] + 1 : 1;
                    }
                    if (ann['appearances'][j][_fdid] in doc2pos){
                        doc2pos[ann['appearances'][j][_fdid]].push(ann['appearances'][j]);
                    }else{
                        doc2pos[ann['appearances'][j][_fdid]] = [ann['appearances'][j]];
                    }
                }
                if (Object.keys(doc2pos).length > 0){
                    if (cc in ctx_concepts){
                        var exist_doc2pos = ctx_concepts[cc];
                        for (var d in doc2pos){
                            if (d in exist_doc2pos){
                                exist_doc2pos[d] = exist_doc2pos[d].concat(doc2pos[d]);
                            }else{
                                exist_doc2pos[d] = doc2pos[d];
                            }
                        }
                    }else{
                        ctx_concepts[cc] = doc2pos;
                    }
                }                
            }
        }
        console.log(ctx_concepts);
        entityMention.all = ctx_concepts;
        _context_concepts.freqs[entityObj['_id']] = ctx_to_freq;
        $.extend(_context_concepts.mentions, ctx_concepts);

        //render summarise result
        $(row).find('.allM').html(totalM);
        $(row).find('.sum').attr('entityId', entityObj['_id']);
    }

    function count_typed_freq(mentionType){
        var num_pos = 0;
        for (var i=0; i<_context_concepts[mentionType].length;i++){
            var t = _context_concepts[mentionType][i];
            num_pos += _context_concepts['freqs'][t['_id']];
        }
        return num_pos;
    }

    /**
     * calculate the fulltext annotation setting and then
     * call the rendering function to display the highlighted full
     * text
     *
     * @param ctx_concepts - the set of concepts to be rendered
     */
    function show_matched_docs(ctx_concepts){
        resetDocConceptCanvas();
        var doc2mentions = {};
        for (var cc in ctx_concepts){
            var cc_doc_mentions = ctx_concepts[cc];
            for(var d in cc_doc_mentions){
                if (d in doc2mentions){
                    doc2mentions[d] = doc2mentions[d].concat(cc_doc_mentions[d]);
                }else{
                    doc2mentions[d] = cc_doc_mentions[d];
                }
            }
        }
        _resultSize = Object.keys(doc2mentions).length;
        _currentDocMentions = doc2mentions;
        showCurrentPage();
    }

    /**
     * render current document fulltext with annotations highlighted
     */
    function showCurrentPage(){
        renderPageInfo();
        render_results(_currentDocMentions);
    }

    /**
     * render pagination controls
     */
    function renderPageInfo(){
        var totalPages = Math.floor(_resultSize / _pageSize) + (_resultSize % _pageSize == 0 ? 0 : 1);
        $('.clsPageInfo').html(_resultSize + " results, pages: " + (totalPages == 0 ? 0 : (_pageNum + 1) ) + "/" + totalPages);
        if (_pageNum + 1 < totalPages){
            $('.clsNext').addClass('clsActive');

        }else{
            $('.clsNext').removeClass('clsActive');
        }
        if (_pageNum > 0){
            $('.clsPrev').addClass('clsActive');
        }else{
            $('.clsPrev').removeClass('clsActive');
        }
        $('#pageCtrl').show();
    }

    /**
     * highlight fulltext with annotation metadata
     *
     * @param anns
     * @param text
     * @param snippet
     * @returns {string}
     */
    function highlight_text(anns, text, snippet, docId){
        var hos = [];
        for (var idx in anns){
            hos.push({"term": "", "s": anns[idx]['offset_start'], "e": anns[idx]['offset_end']});
        }
        hos = hos.sort(function(a, b){
            return a["s"] - b["s"];
        });

        var moreTextLen = 20;
        var new_str = "";
        if (hos.length > 0){
            var prev_pos = snippet ? (hos[0]['s'] > moreTextLen ? hos[0]['s'] - moreTextLen : hos[0]['s']) : 0;
            if (prev_pos > 0)
                new_str += "...";
            for (var idx in hos){
                new_str += text.substring(prev_pos, hos[idx]["s"]) +
                    "<em>" + text.substring(hos[idx]["s"], hos[idx]["e"]) + 
                    "<span class='feedback' id='d" + docId + "_s" + hos[idx]["s"] + "_e" + hos[idx]["e"] + "'> <button class='fbBtn posM'>posM</button> <button class='fbBtn hisM'>hisM</button> <button class='fbBtn negM'>negM</button> <button class='fbBtn otherM'>otherM</button></span>" + 
                    "</em>";
                prev_pos = hos[idx]["e"];
                if (snippet)
                    break;
            }
            var endPos = snippet ? Math.min(parseInt(prev_pos) + moreTextLen, text.length) : text.length;
            new_str += text.substring(prev_pos, endPos);
            if (endPos < text.length)
                new_str += "...";
        }else{
            new_str = snippet ? text.substring(0, Math.min(text.length, moreTextLen)) + "...": text;
        }
        return new_str;
    }

    function render_results(doc2mentions){

        swal("loading documents...");
        var docs = Object.keys(doc2mentions);
        var docId = docs[_pageNum];

        _es_client.get({
            index: __es_fulltext_index,
            type: __es_fulltext_type,
            id: docId
        }).then(function (resp) {
            var doc = {id: docId, mentions: doc2mentions[docId], docDetail: resp['_source']};
            renderDoc(doc);
            $('html, body').animate({
                scrollTop: $("#pageCtrl").offset().top
            }, 500);
        }, function (err) {
            console.trace(err.message);
        });


    }

    function renderDoc(doc){
        var attrs = _display_attrs;

        // var head = "<div class='clsField'>doc id</div>";
        var s =
            "<div class='clsRow'><div class='clsField'>DocID</div>" +
            "<div attr='did' class='clsValue'>" + doc['id'] + "</div></div>";
        var d = doc['docDetail'];
        for(var i=0;i<attrs.length;i++){
            var attrS = '';
            var attr = attrs[i];
            var val = d[attr];
            if (attr == _full_text_attr){
                // val = "<span class='partial'>" + highlight_text(doc['mentions'], d[attr], true) + "</span>";
                val = "<span class='full'>" + highlight_text(doc["mentions"], d[attr], false, doc['id']) + "</span>";
                // val += "<span class='clsMore'>+</span>";
            }
            attrS += "<div class='clsField'>" + attr + "</div>";
            attrS += "<div attr='" + attr + "' class='clsValue'>" + val + "</div>";
            s += "<div class='clsRow clsDoc'>" + attrS + "</div>";
        }

        $('#results').html(s)

        for(var k in _user_feedback){
            $('#' + k + ' .' + _user_feedback[k]).addClass('fbed');
        }
        $('.fbBtn').click(function(){
            var annId = $(this).parent().attr('id');
            var data = {};
            var sel = $(this).html();
            data[annId] = sel;
            qbb.inf.saveEvalResult($.toJSON(data), _invitationId, function(s){
                if(s == 'true'){
                    swal('saved!');
                    $('#' + annId + ' button').removeClass('fbed');
                    $('#' + annId + ' .' + sel).addClass('fbed');
                    // rerender table to reflect the update
                    _user_feedback[annId] = sel;
                    renderSumTable();
                }else{
                    swal('failed in saving!');
                }
            });
        });
        swal.close();
    }

    function getUMLSFromHPO(hpos){
        var mapped = {};
        var query = "";
        for (var idx in hpos){
            if (hpos[idx] in hpo_umls) {
                mapped[hpos[idx]] = [];
                for (var i in hpo_umls[hpos[idx]]){
                    mapped[hpos[idx]].push(hpo_umls[hpos[idx]][i].replace("UMLS:", ""));
                }
            }else {
                query += hpos[idx] + " ";
            }
        }
        return {terms: mapped, query: query};
    }

    function genUMLSToHPO(){
        for (var h in hpo_umls){
            for(var idx in hpo_umls[h]){
                _umlsToHPO[hpo_umls[h][idx]] = h;
            }
        }
    }

    function resetSearchResult(){
        $('#sumTermDiv').html('');
        $('#entitySummHeader').css("visibility", "hidden");
        $('#dataRowDiv').hide();
        $('#entitySumm').css("visibility", "hidden");
        _context_concepts = null;
        _cid2type = {};
        $('#entitySumm').find('.dataRow').remove();
        resetDocConceptCanvas();
    }

    function resetDocConceptCanvas(){
        _pageNum = 0;
        _currentDocMentions = null;
        _resultSize = 0;
        $('#results').html('');
        $('#pageCtrl').hide();
    }

    $(document).ready(function(){
        genUMLSToHPO();
        userLogin();
        // initESClient();

        $('#btnSearch').click(function () {
            resetSearchResult();
            var q = $('#searchInput').val().trim();
            var entity = $('#entityInput').val().trim();
            if (q.length == 0){
                swal({text:"please input your query", showConfirmButton: true});
            }else{
                _queryObj = getUMLSFromHPO(q.split(" "));
                _queryObj["entity"] = entity;
                search(_queryObj);
            }
        });

        $('.clsNext').click(function () {
            if ($(this).hasClass("clsActive")){
                _pageNum++;
                showCurrentPage();
            }
        });

        $('.clsPrev').click(function () {
            if ($(this).hasClass("clsActive")){
                _pageNum--;
                showCurrentPage();
            }
        });
    })

})(this.jQuery)
