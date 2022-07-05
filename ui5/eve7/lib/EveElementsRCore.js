sap.ui.define(['rootui5/eve7/lib/EveManager'], function (EveManager)
{
   "use strict";

   // See also EveScene.js makeGLRepresentation(), there several members are
   // set for the top-level Object3D.

   //==============================================================================
   // EveElemControl
   //==============================================================================

   class EveElemControl
   {

      constructor(pick_state)
      {
         this.state = pick_state;
         // event property can be set by handlers
      }

      invokeSceneMethod(fname, arg)
      {
         if ( ! this.state.top_object || ! this.state.eve_el) return false;

         let s = this.state.top_object.scene;
         if (s && (typeof s[fname] == "function"))
            return s[fname](this.state.eve_el, arg, this.event);
         return false;
      }

      getTooltipText()
      {
         let el = this.state.eve_el;
         return el.fTitle || el.fName || "";
      }

      extractIndex()
      {
         return this.state.instance;
      }

      elementHighlighted(indx)
      {
         // default is simple selection, we ignore the indx
         this.invokeSceneMethod("processElementHighlighted", indx);
      }

      elementSelected(indx)
      {
         // default is simple selection, we ignore the indx
         this.invokeSceneMethod("processElementSelected", indx);
      }

   } // class EveElemControl


   //==============================================================================
   // EveElements
   //==============================================================================

   const GL = { POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4 };
   let RC;

   function RcCol(root_col)
   {
      return new RC.Color(EVE.JSR.getColor(root_col));
   }

   //------------------------------------------------------------------------------
   // Builder functions of this class are called by EveScene to create RCore
   // objects representing an EveElement. They can have children if multiple RCore
   // objects are required (e.g., mesh + lines + points).
   //
   // The top-level object returned by these builder functions will get additional
   // properties injected by EveScene:
   // - eve_el
   // - scene.
   //
   // Object picking functions in GlViewerRCore will navigate up the parent hierarchy
   // until an object with eve_el property is set.
   // If secondary selection is enabled on the eve_el, instance picking will be called
   // as well and the returned ID will be used as the index for secondary selection.
   // This can be overriden by setting get_ctrl property of any RCore object to a function
   // that takes a reference to the said argument and returns an instance of class
   // EveElemControl.
   // If get_ctrl is not found on the upwards traversal to object with eve_el property set
   // the base EveElemControl is created with the top-level as the argument.

   class EveElements
   {
      constructor(rc, viewer) {
         console.log("EveElements -- RCore");

         RC = rc;
         this.viewer = viewer;

         RC.Cache.enabled = true;

         this.tex_cache = new RC.TextureCache;

         this.POINT_SIZE_FAC = 1;
         this.LINE_WIDTH_FAC = 1;
         this.ColorWhite = new RC.Color(0xFFFFFF);
         this.ColorBlack = new RC.Color(0x000000);
      }

      //----------------------------------------------------------------------------
      // Helper functions
      //----------------------------------------------------------------------------

      GenerateTypeName(obj) { return "RC." + obj.type; }

      SetupPointLineFacs(pf, lf)
      {
         this.POINT_SIZE_FAC = pf;
         this.LINE_WIDTH_FAC = lf;
      }

      UpdatePointPickingMaterial(obj)
      {
         let m = obj.material;
         let p = obj.pickingMaterial;
         p.usePoints = m.usePoints;
         p.pointSize = m.pointSize;
         p.pointsScale = m.pointsScale;
         p.drawCircles = m.drawCircles;
      }

      RcPointMaterial(color, opacity, point_size, props)
      {
         let mat = new RC.PointBasicMaterial;
         mat._color = this.ColorBlack; // color;
         mat._emissive = color;
         if (opacity !== undefined && opacity < 1.0) {
            mat._opacity = opacity;
            mat._transparent = true;
            mat._depthWrite = false;
         }
         mat._pointSize = this.POINT_SIZE_FAC;
         if (point_size !== undefined) mat._pointSize *= point_size;
         if (props !== undefined) {
            mat.update(props);
         }
         return mat;
      }

      RcLineMaterial(color, opacity, line_width, props)
      {
         let mat = new RC.MeshBasicMaterial; // StripeBasicMaterial
         mat._color = this.ColorBlack;
         mat._emissive = color;
         if (opacity !== undefined && opacity < 1.0) {
            mat._opacity = opacity;
            mat._transparent = true;
            mat._depthWrite = false;
         }
         mat._lineWidth = this.LINE_WIDTH_FAC;
         if (line_width !== undefined) mat._lineWidth *= line_width;
         if (props !== undefined) {
            mat.update(props);
         }
         return mat;
      }

      RcFlatMaterial(color, opacity, props)
      {
         let mat = new RC.MeshBasicMaterial;
         mat._color = color;
         mat._emissive = color; // mat.emissive.offsetHSL(0, 0.1, 0);
         // Something is strange here. Tried also white (no change) / black (no fill -- ?).
         // mat._emissive = new RC.Color(color);
         // mat.emissive.multiplyScalar(0.1);
         // offsetHSL(0, -0.5, -0.5);

         if (opacity !== undefined && opacity < 1.0) {
            mat._opacity = opacity;
            mat._transparent = true;
            mat._depthWrite = false;
         }
         if (props !== undefined) {
            mat.update(props);
         }
         return mat;
      }

      RcFancyMaterial(color, opacity, props)
      {
         let mat = new RC.MeshPhongMaterial;
         // let mat = new RC.MeshBasicMaterial;

         mat._color = color;
         mat._specular = this.ColorWhite;
         mat._shininess = 32;
   
         if (opacity !== undefined && opacity < 1.0) {
            mat._opacity = opacity;
            mat._transparent = true;
            mat._depthWrite = false;
         }
         if (props !== undefined) {
            mat.update(props);
         }
         return mat;
      }

      RcPickable(el, obj3d, do_children = true, ctrl_class = EveElemControl)
      {
         if (el.fPickable) {
            obj3d.get_ctrl = function(state) { return new ctrl_class(state); }
            obj3d.pickable = true;
            if (do_children) {
               for (let i = 0; i < obj3d.children.length; ++i)
                  obj3d.children[i].pickable = true;
            }
            // using auto-id now obj3d.colorID = el.fElementId;
            // console.log("YES Pickable for", el.fElementId, el.fName)
            return true;
         } else {
            // console.log("NOT Pickable for", el.fElementId, el.fName)
            return false;
         }
      }

      TestRnr(name, obj, rnr_data)
      {
         if (obj && rnr_data && rnr_data.vtxBuff) return false;

         let cnt = this[name] || 0;
         if (cnt++ < 5) console.log(name, obj, rnr_data);
         this[name] = cnt;
         return true;
      }

      GetLumAlphaTexture(name, callback)
      {
         let url = window.location.origin + '/rootui5sys/eve7/textures/' + name;

         this.tex_cache.deliver(url,
            callback,
            (image) => {
               return new RC.Texture
                  (image, RC.Texture.ClampToEdgeWrapping, RC.Texture.ClampToEdgeWrapping,
                          RC.Texture.LinearFilter, RC.Texture.LinearFilter,
                          RC.Texture.LUMINANCE_ALPHA, RC.Texture.LUMINANCE_ALPHA, RC.Texture.UNSIGNED_BYTE,
                          image.width, image.height);
            },
            () => { this.viewer.request_render() }
         );
      }

      //----------------------------------------------------------------------------
      // Builder functions
      //----------------------------------------------------------------------------

      //==============================================================================
      // makeHit
      //==============================================================================

      makeHit(hit, rnr_data)
      {
         if (this.TestRnr("hit", hit, rnr_data)) return null;

         let   col   = RcCol(hit.fMarkerColor);
         const msize = this.POINT_SIZE_FAC * hit.fMarkerSize;
         let sm = new RC.ZSpriteBasicMaterial( {
            SpriteMode: RC.SPRITE_SPACE_SCREEN, SpriteSize: [msize, msize],
            color: this.ColorBlack,
            emissive: col,
            diffuse: col.clone().multiplyScalar(0.5) } );
         sm.transparent = true;
         // sm.depthWrite = false;
         this.GetLumAlphaTexture("star5-32a.png", (tex) => {
            sm.addMap(tex);
         });

         sm.instanceData = new RC.Texture(rnr_data.vtxBuff,
            RC.Texture.ClampToEdgeWrapping, RC.Texture.ClampToEdgeWrapping,
            RC.Texture.NearestFilter, RC.Texture.NearestFilter,
            // RC.Texture.R32F, RC.Texture.R32F, RC.Texture.FLOAT,
            RC.Texture.RGBA32F, RC.Texture.RGBA, RC.Texture.FLOAT,
            hit.fTexX, hit.fTexY);

         let s = new RC.ZSprite(null, sm);
         s.frustumCulled = false; // need a way to speciy bounding box/sphere !!!
         s.instanced = true;
         s.instanceCount = hit.fSize;

         this.RcPickable(hit, s);

         s.dispose = () => { delete this; } // ??? RCRC instanceData texture ???

         return s;
      }

      //==============================================================================
      // makeTrack
      //==============================================================================

      makeTrack(track, rnr_data)
      {
         if (this.TestRnr("track", track, rnr_data)) return null;

         let N = rnr_data.vtxBuff.length / 3;
         let track_width = 2 * (track.fLineWidth || 1) * this.LINE_WIDTH_FAC;
         let track_color = RcCol(track.fLineColor);

         if (EVE.JSR.browser.isWin) track_width = 1;  // not supported on windows

         let buf = new Float32Array((N - 1) * 6), pos = 0;
         for (let k = 0; k < (N - 1); ++k)
         {
            buf[pos] = rnr_data.vtxBuff[k * 3];
            buf[pos + 1] = rnr_data.vtxBuff[k * 3 + 1];
            buf[pos + 2] = rnr_data.vtxBuff[k * 3 + 2];

            let breakTrack = false;
            if (rnr_data.idxBuff)
               for (let b = 0; b < rnr_data.idxBuff.length; b++)
               {
                  if ((k + 1) == rnr_data.idxBuff[b])
                  {
                     breakTrack = true;
                     break;
                  }
               }

            if (breakTrack)
            {
               buf[pos + 3] = rnr_data.vtxBuff[k * 3];
               buf[pos + 4] = rnr_data.vtxBuff[k * 3 + 1];
               buf[pos + 5] = rnr_data.vtxBuff[k * 3 + 2];
            } else
            {
               buf[pos + 3] = rnr_data.vtxBuff[k * 3 + 3];
               buf[pos + 4] = rnr_data.vtxBuff[k * 3 + 4];
               buf[pos + 5] = rnr_data.vtxBuff[k * 3 + 5];
            }

            pos += 6;
         }

         let style = (track.fLineStyle > 1) ? EVE.JSR.getSvgLineStyle(track.fLineStyle) : "",
            dash = style ? style.split(",") : [],
            lineMaterial;

         if (dash && (dash.length > 1))
         {
            lineMaterial = this.RcLineMaterial(track_color, 1.0, track_width, { dashSize: parseInt(dash[0]), gapSize: parseInt(dash[1]) });
         } else
         {
            lineMaterial = this.RcLineMaterial(track_color, 1.0, track_width);
         }

         let geom = new RC.Geometry();
         geom.vertices = new RC.BufferAttribute(buf, 3);

         let line = new RC.Line(geom, lineMaterial);
         line.renderingPrimitive = RC.LINES;
         line.lineWidth = track_width;

         // required for the dashed material
         //if (dash && (dash.length > 1))
         //   line.computeLineDistances();

         //line.hightlightWidthScale = 2;

         this.RcPickable(track, line);
         line.dispose = function() { /*delete this.geometry; delete this.material;*/ };
         return line;
      }

      //==============================================================================
      // makeJet
      //==============================================================================

      makeJet(jet, rnr_data)
      {
         if (this.TestRnr("jet", jet, rnr_data)) return null;

         // console.log("make jet ", jet);
         // let jet_ro = new RC.Object3D();
         let pos_ba = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
         let N = rnr_data.vtxBuff.length / 3;

         let geo_body = new RC.Geometry();
         geo_body.vertices = pos_ba;
         let idcs = new Uint32Array(3 + 3 * (N - 2));
         idcs[0] = 0; idcs[1] = N - 1; idcs[2] = 1;
         for (let i = 1; i < N - 1; ++i)
         {
            idcs[3 * i] = 0; idcs[3 * i + 1] = i; idcs[3 * i + 2] = i + 1;
            // idcs.push( 0, i, i + 1 );
         }
         geo_body.indices = new RC.BufferAttribute(idcs, 1);
         geo_body.computeVertexNormals();

         let geo_rim = new RC.Geometry();
         geo_rim.vertices = pos_ba;
         idcs = new Uint32Array(N - 1);
         for (let i = 1; i < N; ++i) idcs[i - 1] = i;
         geo_rim.indices = new RC.BufferAttribute(idcs, 1);

         let geo_rays = new RC.Geometry();
         geo_rays.vertices = pos_ba;
         idcs = new Uint32Array(2 * (1 + ((N - 1) / 4)));
         let p = 0;
         for (let i = 1; i < N; i += 4)
         {
            idcs[p++] = 0; idcs[p++] = i;
         }
         geo_rays.indices = new RC.BufferAttribute(idcs, 1);

         let mcol = RcCol(jet.fMainColor);
         let lcol = RcCol(jet.fLineColor);

         let mesh = new RC.Mesh(geo_body, this.RcFancyMaterial(mcol, 0.5, { side: RC.FRONT_AND_BACK_SIDE }));

         let line1 = new RC.Line(geo_rim, this.RcLineMaterial(lcol, 0.8, 4));
         line1.renderingPrimitive = RC.LINE_LOOP;

         let line2 = new RC.Line(geo_rays, this.RcLineMaterial(lcol, 0.8, 1));
         line2.renderingPrimitive = RC.LINES;

         mesh.add(line1);
         mesh.add(line2);
         this.RcPickable(jet, mesh);

         mesh.dispose = function() {
            //this.children.forEach(c => { delete c.geometry; delete c.material; });
            //delete this.geometry; delete this.material;
         };

         return mesh;
      }

      makeJetProjected(jet, rnr_data)
      {
         // JetProjected has 3 or 4 points. 0-th is apex, others are rim.
         // Fourth point is only present in RhoZ when jet hits barrel/endcap transition.

         // console.log("makeJetProjected ", jet);

         if (this.TestRnr("jetp", jet, rnr_data)) return null;

         let pos_ba = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
         let N = rnr_data.vtxBuff.length / 3;

         let geo_body = new RC.Geometry();
         geo_body.vertices = pos_ba;
         let idcs = new Uint32Array(N > 3 ? 6 : 3);
         idcs[0] = 0; idcs[1] = 1; idcs[2] = 2;
         if (N > 3) { idcs[3] = 0; idcs[4] = 2; idcs[5] = 3; }
         geo_body.indices = new RC.BufferAttribute(idcs, 1);
         geo_body.computeVertexNormals();

         let geo_rim = new RC.Geometry();
         geo_rim.vertices = pos_ba;
         idcs = new Uint32Array(N - 1);
         for (let i = 1; i < N; ++i) idcs[i - 1] = i;
         geo_rim.indices = new RC.BufferAttribute(idcs, 1);

         let geo_rays = new RC.Geometry();
         geo_rays.vertices = pos_ba;
         idcs = new Uint32Array(4); // [ 0, 1, 0, N-1 ];
         idcs[0] = 0; idcs[1] = 1; idcs[2] = 0; idcs[3] = N - 1;
         geo_rays.indices = new RC.BufferAttribute(idcs, 1);;

         let fcol = RcCol(jet.fFillColor);
         let lcol = RcCol(jet.fLineColor);
         // Process transparency !!!
         // console.log("cols", fcol, lcol);

         // double-side material required for correct tracing of colors - otherwise points sequence should be changed
         let mesh = new RC.Mesh(geo_body, this.RcFlatMaterial(fcol, 0.5));

         let line1 = new RC.Line(geo_rim, this.RcLineMaterial(lcol, 0.8, 2));

         let line2 = new RC.Line(geo_rays, this.RcLineMaterial(lcol, 0.8, 0.5));
         line2.renderingPrimitive = RC.LINES;

         mesh.add(line1);
         mesh.add(line2);
         this.RcPickable(jet, mesh);

         mesh.dispose = function() {
            //this.children.forEach(c => { delete c.geometry; delete c.material; });
            //delete this.geometry; delete this.material;
         };
   
         return mesh;
      }


      //==============================================================================
      // makeEveGeometry / makeEveGeoShape
      //==============================================================================

      makeEveGeometry(rnr_data)
      {
         let nVert = rnr_data.idxBuff[1] * 3;

         if (rnr_data.idxBuff[0] != GL.TRIANGLES) throw "Expect triangles first.";
         if (2 + nVert != rnr_data.idxBuff.length) throw "Expect single list of triangles in index buffer.";

         let geo = new RC.Geometry();
         geo.vertices = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
         geo.indices = new RC.BufferAttribute(rnr_data.idxBuff, 1);
         geo.setDrawRange(2, nVert);
         geo.computeVertexNormalsIdxRange(2, nVert);

         // XXXX Fix this. It seems we could have flat shading with usage of simple shaders.
         // XXXX Also, we could do edge detect on the server for outlines.
         // XXXX a) 3d objects - angle between triangles >= 85 degrees (or something);
         // XXXX b) 2d objects - segment only has one triangle.
         // XXXX Somewhat orthogonal - when we do tesselation, conversion from quads to
         // XXXX triangles is trivial, we could do it before invoking the big guns (if they are even needed).
         // XXXX Oh, and once triangulated, we really don't need to store 3 as number of verts in a poly each time.
         // XXXX Or do we? We might need it for projection stuff.

         return geo;
      }

      makeEveGeoShape(egs, rnr_data)
      {
         let geom = this.makeEveGeometry(rnr_data);

         let fcol = RcCol(egs.fFillColor);

         let material = this.RcFancyMaterial(fcol, 0.2);
         material.side = RC.FRONT_AND_BACK_SIDE;
         material.specular = new RC.Color(1, 1, 1);
         material.shininess = 50;

         let mesh = new RC.Mesh(geom, material);
         this.RcPickable(egs, mesh);
         return mesh;
      }


      //==============================================================================
      // makePolygonSetProjected
      //==============================================================================

      makePolygonSetProjected(psp, rnr_data)
      {
         let psp_ro = new RC.Group();
         let pos_ba = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
         let idx_ba = new RC.BufferAttribute(rnr_data.idxBuff, 1);

         let ib_len = rnr_data.idxBuff.length;

         let fcol = RcCol(psp.fMainColor);

         let material = this.RcFlatMaterial(fcol, 0.4);
         material.side = RC.FRONT_AND_BACK_SIDE;

         let line_mat = this.RcLineMaterial(fcol);

         for (let ib_pos = 0; ib_pos < ib_len;)
         {
            if (rnr_data.idxBuff[ib_pos] == GL.TRIANGLES)
            {
               let geo = new RC.Geometry();
               geo.vertices = pos_ba;
               geo.indices = idx_ba;
               geo.setDrawRange(ib_pos + 2, 3 * rnr_data.idxBuff[ib_pos + 1]);
               geo.computeVertexNormalsIdxRange(ib_pos + 2, 3 * rnr_data.idxBuff[ib_pos + 1]);

               let mesh = new RC.Mesh(geo, material);
               this.RcPickable(psp, mesh);
               psp_ro.add(mesh);

               ib_pos += 2 + 3 * rnr_data.idxBuff[ib_pos + 1];
            }
            else if (rnr_data.idxBuff[ib_pos] == GL.LINE_LOOP)
            {
               let geo = new RC.Geometry();
               geo.vertices = pos_ba;
               geo.indices = idx_ba;
               geo.setDrawRange(ib_pos + 2, rnr_data.idxBuff[ib_pos + 1]);

               let ll = new RC.Line(geo, line_mat);
               ll.renderingPrimitive = RC.LINE_LOOP;
               psp_ro.add(ll);

               ib_pos += 2 + rnr_data.idxBuff[ib_pos + 1];
            }
            else
            {
               console.error("Unexpected primitive type " + rnr_data.idxBuff[ib_pos]);
               break;
            }

         }
         this.RcPickable(psp, psp_ro);

         return psp_ro;
      }

      //==============================================================================

      makeStraightLineSet(el, rnr_data)
      {
         console.log("makeStraightLineSet ...");

         let obj3d = new RC.Group();

         let buf = new Float32Array(el.fLinePlexSize * 6);
         for (let i = 0; i < el.fLinePlexSize * 6; ++i)
         {
            buf[i] = rnr_data.vtxBuff[i];
         }

         let line_mat = this.RcLineMaterial(RcCol(el.fMainColor));

         let geom = new RC.Geometry();
         geom.vertices = new RC.BufferAttribute(buf, 3);

         let line = new RC.Line(geom, line_mat);
         line.renderingPrimitive = RC.LINES;

         this.RcPickable(el, line);
         obj3d.add(line);

         // ---------------- DUH, could share buffer attribute. XXXXX

         let msize = el.fMarkerPlexSize;

         let p_buf = new Float32Array(msize * 3);

         let startIdx = el.fLinePlexSize * 6;
         let endIdx = startIdx + msize * 3;
         for (let i = startIdx; i < endIdx; ++i)
         {
            p_buf[i] = rnr_data.vtxBuff[i];
         }

         let p_geom = new RC.Geometry();
         p_geom.vertices = new RC.BufferAttribute(p_buf, 3);

         let p_mat = this.RcPointMaterial(RcCol(el.fMarkerColor), 1, el.fMarkerSize);
         p_mat.pointsScale = false;
         p_mat.drawCircles = true;

         let marker = new RC.Point({ geometry: p_geom, material: p_mat });
         this.UpdatePointPickingMaterial(marker);
         this.RcPickable(el, marker);
         obj3d.add(marker);

         // For secondary selection, see EveElements.js
         obj3d.eve_idx_buf = rnr_data.idxBuff;

         /*
         let octrl;
         if (el.fSecondarySelect)
            octrl = new StraightLineSetControl(obj3d);
         else
            octrl = new EveElemControl(obj3d);

         line.get_ctrl   = function() { return octrl; };
         marker.get_ctrl = function() { return octrl; };
         obj3d.get_ctrl  = function() { return octrl; };
         */

         return obj3d;
      }

   } // class EveElements

   //==============================================================================

   EVE.EveElements = EveElements;

   return EveElements;
});
