// if(window.location.protocol !== 'https:') window.location.replace('https://' + window.location.hostname + window.location.pathname);
// if ('serviceWorker' in window.navigator) {
//   window.navigator.serviceWorker.register('sw.js', {scope: './'}).catch(function(error) {
//     console.error('Service Worker Registration failed with ' + error);
//   });
// }

import './main.css'

import $ from 'jquery';
import 'bootstrap';
import { sessionSkeleton } from './helpers/session';
import addTag from 'google_tag';

addTag('UA-116308624-1');

if(window.navigator.userAgent.indexOf('MSIE') > -1 || window.navigator.appName.indexOf('Microsoft Internet Explorer') > -1){
  $('#ie-warning').modal('show');
  throw new Error('MicrobeTrace does not work on Internet Explorer.');
}

if(!localStorage.getItem('licenseAccepted')){
  $('#acceptAgreement').on('click', function(){
    localStorage.setItem('licenseAccepted', new Date());
  });
  $('#licenseAgreement').modal({
    backdrop: 'static',
    keyboard: false
  });
}

window.session = sessionSkeleton();
window.temp = {
  style: {
    linkColorMap: function(){ return session.style.widgets['link-color']; },
    nodeColorMap: function(){ return session.style.widgets['node-color']; },
    nodeSymbolMap: function(){ return session.style.widgets['node-symbol']; }
  },
  componentCache: {}
};

window.layout = new window.GoldenLayout({
  settings: {
    selectionEnabled: true,
    showPopoutIcon: false
  },
  content: [{
    type: 'stack',
    content: []
  }]
}, $('#main-panel'));

layout.init();

layout.contentItems = [];

// Let's set up the Nav Bar
$('#stash-data').on('click', function(){
  localforage.setItem('stash-'+Date.now()+'-'+$('#stash-name').val(), JSON.stringify(session)).then(function(){
    alertify.success('Session Stashed Successfully!');
  });
});

var table = new Tabulator('#recall-stashes-available', {
  height: '100%',
  layout: 'fitColumns',
  selectable: 1,
  columns: [
    {title:'Name', field:'name'},
    {title:'Date', field:'date', align:'right', sorter:'date'}
  ]
});

function updateTable(){
  localforage.keys().then(function(keys){
    var rows = [];
    keys.forEach(function(k){
      if(!k.substring(0, 5) === 'stash') return;
      rows.push({
        fullname: k,
        name: k.substring(20),
        date: (new Date(parseFloat(k.substring(6,19)))).toISOString()
      });
    });
    table.setData(rows);
  });
}

$('#RecallDataTab').on('click', function(){
  updateTable();
  $('#session-recall-modal').modal('show');
});

$('#recall-delete-stash').on('click', function(){
  var key = table.getSelectedData()[0].fullname;
  localforage.removeItem(key).then(function(){
    updateTable();
    alertify.success('That stash has been deleted.');
  });
});

$('#recall-load-stash').on('click', function(){
  var key = table.getSelectedData()[0].fullname;
  localforage.getItem(key).then(function(json){
    app.applySession(JSON.parse(json));
    $('#session-recall-modal').modal('hide');
  });
});

$('#save-data').on('click', function(){
  var name = $('#save-file-name').val();
  var format = $('#save-file-format').val();
  var data;
  if(format === 'microbetracestyle'){
    data = JSON.stringify(session.style);
  } else if(format === 'hivtrace'){
    data = app.exportHIVTRACE();
  } else {
    data = JSON.stringify(session);
  }
  if($('#save-file-compress').is(':checked')){
    var zip = new JSZip();
    zip.file(name + '.' + format, data);
    zip.generateAsync({
      type:'blob',
      compression: 'DEFLATE',
      compressionOptions: {
      level: 9
    }}).then(function(content) {
      saveAs(content, name + '.zip');
    });
  } else {
    var blob = new Blob([data], {type: 'application/json;charset=utf-8'});
    saveAs(blob, name + '.' + format);
  }
});

$('#OpenTab').on('change', function(e){
  if(e.target.files.length > 0){
    var extension = e.target.files[0].name.split('.').pop().toLowerCase();
    if(extension === 'zip'){
      var new_zip = new JSZip();
      new_zip.loadAsync(e.target.files[0])
        .then(function(zip) {
          zip.forEach(function(relativePath, zipEntry){
            extension = zipEntry.name.split('.').pop();
            zipEntry.async('string').then(function(c){
              app.processJSON(c, extension);
            });
          });
        });
    } else {
      var reader = new FileReader();
      reader.onloadend = function(out){
        app.processJSON(out.target.result, extension);
      };
      reader.readAsText(e.target.files[0], 'UTF-8');
    }
  }
});

$('#AddDataTab').on('click', function(){
  $('#network-statistics-hide').trigger('click');
  app.launchView('files');
});

$('#NewTab').on('click', function(){
  $('#exit-modal').modal();
});

$('#exit-button').on('click', app.reset);

$('.viewbutton').on('click', function(){ app.launchView($(this).data('href')); });

$('#ReloadTab').on('click', function(){
  $('#exit-button').on('click', function(){ window.location.reload(); });
  $('#exit-modal').modal();
});

$('#FullScreenTab').on('click', function(){ screenfull.toggle(); });

$('[name="NNOptions"]').on('change', function(){
  app.updateNetwork($('#HideSingletons').is(':checked'));
});

$('#links-filter-variable').on('change', function(){
  app.updateThresholdHistogram();
  app.updateStatistics();
  $(window).trigger('link-threshold-change');
});

app.updateThresholdHistogram = function(){
  var width = 280,
      height = 48,
      svg = d3.select('svg#link-threshold-sparkline')
        .html(null)
        .attr('width', width)
        .attr('height', height);

  var lsv = $('#links-filter-variable').val(),
      n = session.data.links.length,
      max = Number.MIN_SAFE_INTEGER,
      min = Number.MAX_SAFE_INTEGER,
      data = Array(n);
  for(var i = 0; i < n; i++){
    var x = parseFloat(session.data.links[i][lsv]);
    data[i] = x;
    if(x < min) min = x;
    if(x > max) max = x;
  }
  var range = max - min;
  var ticks = 40;

  var x = d3.scaleLinear()
    .domain([min, max])
    .range([0, width]);

  var bins = d3.histogram()
      .domain(x.domain())
      .thresholds(x.ticks(ticks))
      (data);

  var y = d3.scaleLinear()
      .domain([0, d3.max(bins, function(d) { return d.length; })])
      .range([height, 0]);

  var bar = svg.selectAll('.bar').data(bins)
    .enter().append('g')
      .attr('class', 'bar')
      .attr('transform', function(d) { return 'translate(' + x(d.x0) + ',' + y(d.length) + ')'; });

  bar.append('rect')
      .attr('x', 1)
      .attr('width', 6)
      .attr('height', function(d) { return height - y(d.length); });

  function updateThreshold(){
    var xc = d3.mouse(svg.node())[0];
    session.state.linkThreshold = xc / width * range * 1.05 + min;
    $('#link-threshold').val(parseFloat(session.state.linkThreshold.toLocaleString()));
  }

  svg.on('click', function(){
    updateThreshold();
    app.setLinkVisibility();
    app.tagClusters();
    if($('#HideSingletons').is(':checked')) app.setNodeVisibility();
    app.computeDegree();
    app.updateStatistics();
    $(window).trigger('link-threshold-change');
  });

  svg.on('mousedown', function(){
    d3.event.preventDefault();
    svg.on('mousemove', updateThreshold);
    svg.on('mouseup mouseleave', function(){
      app.setLinkVisibility();
      app.tagClusters();
      if($('#HideSingletons').is(':checked')) app.setNodeVisibility();
      app.computeDegree();
      app.updateStatistics();
      $(window).trigger('link-threshold-change');
      svg
        .on('mousemove', null)
        .on('mouseup', null)
        .on('mouseleave', null);
    });
  });
  $(window).trigger('link-threshold-change');
};

$('#ShowSingletons, #HideSingletons').on('change', function(e){
  app.setNodeVisibility();
  app.updateStatistics();
});

$('#links-show-nn, #links-show-all').on('change', function(e){
  app.updateStatistics();
  $(window).trigger('link-threshold-change');
});

$('#link-threshold').on('input', function(){
  app.setLinkVisibility();
  app.tagClusters();
  if($('#HideSingletons').is(':checked')) app.setNodeVisibility();
  app.computeDegree();
  app.updateStatistics();
  $(window).trigger('link-threshold-change');
});

$('#network-statistics-hide').parent().on('click', function(){
  $('#network-statistics').fadeOut();
});

$('#network-statistics-show').parent().on('click', function(){
  app.updateStatistics();
  $('#network-statistics').fadeIn();
});

$('#network-statistics').on('contextmenu', function(e){
  e.preventDefault();
  $('#network-statistics-context').css({
    top: e.clientY,
    left: e.clientX,
    display: 'block'
  });
});

$('#hideStats').on('click', function(e){
  $(this).parent().hide();
  $('#network-statistics-hide').parent().click();
});

$('#RevealAllTab').on('click', function(e){
  session.data.clusters.forEach(function(c){ c.visible = true; });
  app.setLinkVisibility();
  $('#ShowSingletons').parent().click(); //calls app.setNodeVisibility();
});

$('#node-color-variable')
  .val(session.style.widgets['node-color-variable'])
  .on('change', function(e){
    var variable = e.target.value;
    session.style.widgets['node-color-variable'] = variable;
    if(variable === 'None'){
      $('#node_color_value_row').slideDown();
      $('#nodeColors').remove();
      $(window).trigger('node-color-change');
      return;
    }
    $('#node_color_value_row').slideUp();
    $('#nodeColors').remove();
    var table = $('<tbody id="nodeColors"></tbody>').appendTo('#group-key');
    table.append('<tr><th contenteditable>Node '+app.titleize(variable)+'</th><th>Color</th><tr>');
    var values = app.createNodeColorMap();
    values.forEach(function(value, i){
      var input = $('<input type="color" value="'+temp.style.nodeColorMap(value)+'" />')
        .on('change', function(evt){
          session.style.nodeColors.splice(i, 1, evt.target.value);
          temp.style.nodeColorMap = d3.scaleOrdinal(session.style.nodeColors).domain(values);
          $(window).trigger('node-color-change');
        });
      var cell = $('<td></td>').append(input);
      var row = $('<tr><td contenteditable>'+app.titleize(''+value)+'</td></tr>').append(cell);
      table.append(row);
    });
    $(window).trigger('node-color-change');
  });

$('#node-color')
  .on('change', function(e){
    session.style.widgets['node-color'] = e.target.value;
    $(window).trigger('node-color-change');
  })
  .val(session.style.widgets['node-color']);

$('#link-color-variable')
  .val(session.style.widgets['link-color-variable'])
  .on('change', function(e){
    var variable = e.target.value;
    session.style.widgets['link-color-variable'] = variable;
    if(variable === 'None'){
      $('#link-color-row').slideDown();
      $('#link-colors').remove();
      $(window).trigger('link-color-change');
      return;
    }
    $('#link-color-row').slideUp();
    $('#link-colors').remove();
    var values = app.createLinkColorMap();
    var table = $('<tbody id="link-colors"></tbody>').appendTo('#group-key');
    table.append('<tr><th contenteditable>Link '+app.titleize(variable)+'</th><th>Color</th><tr>');
    values.forEach(function(value, i){
      var input = $('<input type="color" value="'+temp.style.linkColorMap(value)+'" />')
        .on('change', function(evt){
          session.style.linkColors.splice(i, 1, evt.target.value);
          temp.style.linkColorMap = d3.scaleOrdinal(session.style.linkColors).domain(values);
          $(window).trigger('link-color-change');
        });
      var cell = $('<td></td>').append(input);
      var row = $('<tr><td contenteditable>'+app.titleize(''+value)+'</td></tr>').append(cell);
      table.append(row);
    });
    $(window).trigger('link-color-change');
  });

$('#link-color').on('change', function(e){
  session.style.widgets['link-color'] = e.target.value;
  $(window).trigger('link-color-change');
});

$('#selected-color').on('change', function(e){
  session.style.widgets['selected-color'] = e.target.value;
  session.style.widgets['selected-color-contrast'] = app.contrastColor(e.target.value);
  $(window).trigger('selected-color-change');
});

$('#background-color').on('change', function(e){
  session.style.widgets['background-color'] = e.target.value;
  session.style.widgets['background-color-contrast'] = app.contrastColor(e.target.value);
  $(window).trigger('background-color-change');
});

$('#color-table-show').parent().on('click', function(){
  $('#group-key').fadeIn();
});

$('#color-table-hide').parent().on('click', function(){
  $('#group-key').fadeOut();
});

$('#apply-style').on('change', function(){
  if(this.files.length > 0){
    var reader = new FileReader();
    reader.onload = function(e){
      app.applyStyle(JSON.parse(e.target.result));
    };
    reader.readAsText(this.files[0]);
  }
});

$('#MicroReactTab').on('click', function(){
  var l = {'type':'column','content':[{'type':'row','content':[{'type':'stack','content':[{'type':'geo_map'}]},{'type':'stack','content':[{'type':'phylogenetic_tree'}]}]},{'type':'stack','content':[{'type':'timeline'}]}]};
  app.loadLayout(l);
  setTimeout(function(){ app.loadLayout(l); }, 80);
})

if(window.navigator.onLine){
  $('#HelpTab')
    .removeClass('viewbutton')
    .attr('href', 'https://github.com/CDCgov/MicrobeTrace/wiki')
    .attr('target', '_blank');
  $('.ifOnline').show();
}

$.getJSON('package.json', function(r){
  app.manifest = r;
  $('#version').html(r.version);
});

$.get('.git/HEAD', function(ref){
  var branch = ref.split('/').pop();
  $('#branch')
    .attr('href', 'https://github.com/CDCgov/MicrobeTRACE/tree/' + branch)
    .text(branch);
  $.get('.git/' + ref.split(' ').pop(), function(r){
    $('#commit')
      .attr('href', 'https://github.com/CDCgov/MicrobeTrace/commit/' + r)
      .text(r.slice(0,7));
  });
}).fail(function(){
  $('#branch').parent().remove();
});

$('#group-key-wrapper').on('contextmenu', function(e){
  e.preventDefault();
  $('#group-key-context').css({
    top: e.clientY,
    left: e.clientX,
    display: 'block'
  });
});

$('#group-key-hide').on('click', function(e){
  $(this).parent().hide();
  $('#color-table-hide').parent().click();
});

$('form').on('keydown', function(e){
  if(e.key === 'Enter'){
    e.preventDefault();
    e.stopPropagation();
  }
});

$('#search').on('input', function(e){
  if(e.target.value === ''){
    session.data.nodes.forEach(function(n){ n.selected = false; });
  } else {
    session.data.nodes.forEach(function(n){ n.selected = (n.id.indexOf(e.target.value)>-1); });
    if(!session.data.nodes.some(function(n){ return n.selected; })) alertify.warning('No matches!');
  }
  $(window).trigger('node-selected');
});

app.launchView('files');

$(document).on('keydown', function(e){
  if(e.ctrlKey && e.key === 'f'){
    e.preventDefault();
    $('#search').focus();
  }
  if(e.ctrlKey && e.key === 's'){
    e.preventDefault();
    $('#session-save-modal').modal();
  }
});

layout.on('stateChanged', function(){ session.layout = app.cacheLayout(layout.root.contentItems[0]); });

$(window)
  .on('node-selected', function(){
    $('#numberOfSelectedNodes').text(session.data.nodes.filter(function(d){ return d.selected; }).length.toLocaleString());
  })
  .on('click', function(){
    $('#network-statistics-context, #group-key-context').hide();
  })
  .on('link-threshold-change', function(){
    if(session.style.widgets['link-color-variable'] !== 'None'){
      $('#link-color-variable').trigger('change');
    }
  })
  .on('node-visibility', function(){
    if(session.style.widgets['node-color-variable'] !== 'None'){
      $('#node-color-variable').trigger('change');
    }
  })
  .on('resize', function(){
    layout.root.setSize();
  })
  .on('beforeunload', function(e){
    e.preventDefault();
    $('#exit-button').on('click', function(){ window.location.reload(); });
    $('#exit-modal').modal();
    e.returnValue = 'Are you certain? This session will be lost!';
  });

alertify.defaults.transition = 'slide';
alertify.defaults.theme.ok = 'btn btn-primary';
alertify.defaults.theme.cancel = 'btn btn-danger';
alertify.defaults.theme.input = 'form-control';
