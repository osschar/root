sap.ui.define([
    'sap/ui/core/mvc/Controller',
    "sap/ui/model/json/JSONModel"
], function(Controller, JSONModel) {
    "use strict";

  return Controller.extend("eve.Summary", {
     
     onInit: function () {

        var data = [{ fName: "Event" }];

        var oTree = this.getView().byId("tree");
        oTree.setMode(sap.m.ListMode.Single);
        oTree.setIncludeItemInSelection(true);

        if (false) {
           var oModel = new sap.ui.model.json.JSONModel();
           oModel.setData([]);
           oModel.setSizeLimit(10000);
           this.getView().setModel(oModel, "treeModel");

        } else {
           // old code, keep for history

           var oModel = new sap.ui.model.json.JSONModel();
           oModel.setData([]);
           oModel.setSizeLimit(10000);
           this.getView().setModel(oModel, "treeModel");

           var oStandardTreeItemTemplate = new sap.m.StandardTreeItem({
              title: "{treeModel>fName}",
              visible: "{treeModel>fVisible}",
              type: "{treeModel>fType}"
           });
           oStandardTreeItemTemplate.attachDetailPress({}, this.onDetailPress, this);
           oStandardTreeItemTemplate.attachBrowserEvent("mouseenter", this.onMouseEnter, this);
           oStandardTreeItemTemplate.attachBrowserEvent("mouseleave", this.onMouseLeave, this);
           /*
            var oDataTemplate = new sap.ui.core.CustomData({
                key:"eveElement"
            });
            oDataTemplate.bindProperty("value", "answer");
            */
           oTree.bindItems("treeModel>/", oStandardTreeItemTemplate);
        }

        this.oModelGED = new JSONModel({ "widgetlist" : []});
        sap.ui.getCore().setModel(this.oModelGED, "ged");

        this.oGuiClassDef = {
              "ROOT::Experimental::TEvePointSet" : [{
                 name : "RnrSelf",
                 srv : "SetRnrSelf",
                 member : "fRnrSelf",
                 _type   : "Bool"
              }, {
                 name : "MarkerSize",
                 srv : "SetMarkerSize",
                 member : "fMarkerSize",
                 _type   : "Number"
              }, {
                 name : "MarkerXY",
                 srv : "SetMarkerSize",
                 member : "fMarkerSize",
                 _type   : "Number"
              }],
              "ROOT::Experimental::TEveJetCone" : [{
                 name : "RnrSelf",
                 srv : "SetRnrSelf",
                 member : "fRnrSelf",
                 _type   : "Bool"
              }, {
                 name : "NSeg",
                 srv : "SetNDiv",
                 member : "fNDiv",
                 _type   : "Number"
              }],
              "ROOT::Experimental::TEveTrack" : [{
                 name : "RnrSelf",
                 srv : "SetRnrSelf",
                 member : "fRnrSelf",
                 _type   : "Bool"
              }, {
                 name : "Line width",
                 srv: "SetLineWidth",
                 member : "fLineWidth",
                 _type   : "Number"
              }]
        };

     },

     UpdateMgr : function(mgr) {

        var model = this.getView().getModel("treeModel");
        model.setData(mgr.CreateModel());
        model.refresh(true);

        this.mgr = mgr;

        var oTree = this.getView().byId("tree");
        oTree.expandToLevel(2);
        // console.log('Update summary model');

        // console.log('Update summary model');
     },
        
        addNodesToTreeItemModel: function(el, model) {
           console.log("FILL el ", el.fName)
           model.fName = el.fName;
           model.guid = el.guid;
           if (el.arr) {
              model.arr = new Array(el.arr.length);
              for (var n=0; n< el.arr.length; ++n) {

                 //  console.log("child  ", el.arr[n]);
                 model.arr[n]= {"fName" : "unset"};

                 this.addNodesToTreeItemModel(el.arr[n], model.arr[n]); 
              }
           }
            
            /*
            for (var n=0; n< lst.arr.length; ++n)
            {
                var el = lst.arr[n];
                var node = {
                    "fName" : el.fName,
                    "guid" : el.guid
                };

                model.arr.push(node);
                if (el.arr) {
                    node.arr = [];
                    this.addNodesToTreeItemModel(el, node);
                }
                }
*/
        },
        
        addNodesToCustomModel:function(lst, model) {/*
            for ((var n=0; n< lst.arr.length; ++n))
            {
                var el = lst.arr[n];
                var node = {fName : el.fName , guid : el.guid};
                model.push(node);
                if (el.arr) {
                    node.arr = [];
                    addNodesToTreeItemModel(el, node);
                }
            }
*/
        },
        event: function(lst) {
           this._event = lst;
           // console.log("summary event lst \n", lst);

           var oTreeData = {fName: "unset"}

           oTreeData.arr = [];
           this.addNodesToTreeItemModel(lst, oTreeData);
           // console.log("event model ", { "top" : oTreeData});

           this.model.setData({ "fName" : "Top", "arr" : oTreeData }); // ??? is this necessary

           // console.log("tree ", this.tree.getItems());
           this.model.refresh(true);
           this.tree.expandToLevel(2);
           sap.ui.getCore().setModel(this.model, "treeModel");


           this.oProductModel = new sap.ui.model.json.JSONModel();
           this.oProductModel.setData([this._event]);
           sap.ui.getCore().setModel(this.oProductModel, "event");
        },
        
        makeDataForGED : function (element) {
           console.log("makeDataForGED ", element);
           var arr = [];
           var cgd = this.oGuiClassDef[element._typename];

           this.maxLabelLength = 0;

           if (!cgd) return;

           for (var i=0; i< cgd.length; ++i) {

              var member =  cgd[i].member;
              var v  = element[member];
              var labeledInput = {
                    "value" : v,
                    "name"  : cgd[i].name,
                    "data"  : cgd[i]
              };
              console.log("filling add ", labeledInput, cgd[i]);
              arr.push(labeledInput);
           }


           for (var i = 0; i < cgd.length; ++i) {
              if (this.maxLabelLength < cgd[i].name.length) this.maxLabelLength = cgd[i].name.length;
           }
           this.getView().getModel("ged").setData({"widgetlist":arr});
        },

        onMouseEnter: function(oEvent) {
          var items = this.getView().byId("tree").getItems(), item = null;
          for (var n = 0; n<items.length;++n)
             if (items[n].getId() == oEvent.target.id)
                { item = items[n]; break; }

          // var item = this.getView().byId(oEvent.target.id).getControl();
          
          if (!item) return;
          
          // console.log("EVENT", item.getId()); 

          // var item = this; // oEvent.getSource();

          var path = item.getBindingContext("treeModel").getPath();

          var ttt = item.getBindingContext("treeModel").getProperty(path);

          console.log('highlight', ttt.id);
          
          var masterid = this.mgr.GetMasterId(ttt.id);
          
          this.mgr.ProcessHighlight(this, masterid, true);
        },
        
        onMouseLeave: function(oEvent) {
           // actual call will be performed 100ms later and can be overwritten
           this.mgr.ProcessHighlight(this, 0, false, 100);
        },
        
        onDetailPress: function(oEvent) {
           // when edit button pressed

           var item = oEvent.getSource();

           var path =  item.getBindingContext("treeModel").getPath();
           // console.log("path XXX ", oEvent.getParameter("listItem").getBindingContext("treeModel").getProperty(path) );
           var ttt = item.getBindingContext("treeModel").getProperty(path);

           console.log('path', path, ttt);

           if (!ttt) return;

           this.editorElement = this.mgr.GetElement(ttt.id);

           console.log('path', path, 'ttt', this.editorElement._typename);
           //return;

           var oProductDetailPanel = this.byId("productDetailsPanel");
           var title =   this.editorElement.fName + " (" +  this.editorElement._typename + " )" ;
           //var title =  this.editorElement._typename ;
           oProductDetailPanel.setHeaderText(title);

           var eventPath = item.getBindingContext("treeModel").getPath();
           var oProductDetailPanel = this.byId("productDetailsPanel");
           //console.log("event path ", eventPath);
           oProductDetailPanel.bindElement({ path: eventPath, model: "event" });

           var gedFrame =  this.getView().byId("GED");
           gedFrame.unbindElement();
           gedFrame.destroyContent();
           this.makeDataForGED(this.editorElement);
           // console.log("going to bind >>> ", this.getView().getModel("ged"));
           gedFrame.bindAggregation("content", "ged>/widgetlist"  , this.gedFactory );
        },
        
        onItemPressed: function(oEvent)
        {
           var path =  oEvent.getParameter("listItem").getBindingContext("treeModel").getPath();
           // console.log("path XXX ", oEvent.getParameter("listItem").getBindingContext("treeModel").getProperty(path) );
           var ttt = oEvent.getParameter("listItem").getBindingContext("treeModel").getProperty(path);

           console.log('path', path, ttt, oEvent);

           if (!ttt) return;

           var obj = this.mgr.GetElement(ttt.id);

           console.log('Press', obj);
        },
        
        gedFactory:function(sId, oContext)
        {
           // console.log("factory ", oContext.oModel.oData[oContext.getPath()]);
           // console.log("factory id ",sId);
           var base = "/widgetlist/";
           var path = oContext.getPath();
           var idx = path.substring(base.length);
           var customData =  oContext.oModel.oData["widgetlist"][idx].data;
           var controller =  sap.ui.getCore().byId("TopEveId--Summary").getController();
           var widget;
           switch (customData._type) {

           case "Number":
              var widget = new sap.m.Input(sId, {
                 value: {
                    path: "ged>value"
                 },
                 change: function(event) {
                    controller.sendMethodInvocationRequest(event.getParameter("value"), event);
                 }
              });
              widget.setType(sap.m.InputType.Number);
              break;

           case "Bool":
              widget = new sap.m.CheckBox(sId, {
                 selected: {
                    path: "ged>value",
                 },
                 select: function(event) {
                    controller.sendMethodInvocationRequest(event.getSource().getSelected(), event);
                 }
              });
              break;

           }
           widget.data("myData", customData);

           var label = new sap.m.Text(sId + "label", { text:{ path: "ged>name"}});
           label.setWidth(controller.maxLabelLength+"ex");
           label.addStyleClass("sapUiTinyMargin");
           var HL= new sap.ui.layout.HorizontalLayout({
              content : [label, widget]
           });

           return HL;
        },
        sendMethodInvocationRequest: function(value, event) {
           // console.log("on change !!!!!!", event.getSource().data("myData"));
           var mir =  event.getSource().data("myData").srv + "( " + value + " )";
           // console.log("=====> ", mir);
           var obj = {"mir" : mir, "fElementId" : this.editorElement.fElementId, "class" : this.editorElement._typename};

           sap.ui.getCore().byId("TopEveId").getController().handle.Send(JSON.stringify(obj)); 
        },
        changeNumPoints:function()
        {
           var myJSON = "changeNumPoints(" +  this.editorElement.guid + ", "  + this.editorElement.fN +  ")";
           sap.ui.getCore().byId("TopEveId").getController().getHandle().Send(myJSON);
        },
        printEvent: function(event)
        {  
           var propertyPath = event.getSource().getBinding("value").getPath();
           // console.log("property path ", propertyPath);
           var bindingContext = event.getSource().getBindingContext("event");

           var path =  bindingContext.getPath(propertyPath);
           var object =  bindingContext.getObject(propertyPath);
           // console.log("obj ",object );

           this.changeNumPoints();
        },
        changeRnrSelf: function(event) {
           console.log("change Rnr ", event.getParameters());

           var myJSON = "changeRnrSelf(" +  this.editorElement.guid + ", "  + event.getParameters().selected +  ")";
           sap.ui.getCore().byId("TopEveId").getController().getHandle().Send(myJSON); 
        },
        changeRnrChld: function(event) {
           console.log("change Rnr ", event, " source ", event.getSource());
        }
    });

});
