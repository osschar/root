// @(#)root/eve:$Id$
// Authors: Matevz Tadel & Alja Mrak-Tadel: 2006, 2007

/*************************************************************************
 * Copyright (C) 1995-2007, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#ifndef ROOT_TEveElement_hxx
#define ROOT_TEveElement_hxx

#include "ROOT/TEveUtil.hxx"
#include "ROOT/TEveVector.hxx"
#include "ROOT/TEveProjectionBases.hxx"
#include "ROOT/json.hxx"

#include "TNamed.h"
#include "TRef.h"

class TGeoMatrix;

namespace ROOT { namespace Experimental
{
typedef unsigned int ElementId_t;

class TEveScene;
class TEveCompound;
class TEveTrans;

/******************************************************************************/
// TEveElement
/******************************************************************************/

// Temporarily here
class RenderData
{
public:
   // If Primitive_e is changed, change also definition in EveElements.js.

   enum Primitive_e { GL_POINTS = 0, GL_LINES, GL_LINE_LOOP, GL_LINE_STRIP, GL_TRIANGLES };

   RenderData(){}
   RenderData(const char* f, int size_vert=0, int size_norm=0, int size_idx=0) :
      fRnrFunc(f)
   {
      if (size_vert > 0)  fVertexBuffer.reserve(size_vert);
      if (size_norm > 0)  fNormalBuffer.reserve(size_norm);
      if (size_idx  > 0)  fIndexBuffer .reserve(size_idx);
   }
   virtual ~RenderData(){}

   void PushV(float x)                   { fVertexBuffer.push_back(x); }
   void PushV(float x, float y, float z) { PushV(x); PushV(y); PushV(z); }
   void PushV(const TEveVectorF &v)      { PushV(v.fX); PushV(v.fY); PushV(v.fZ); }

   void PushN(float x)                   { fNormalBuffer.push_back(x); }
   void PushN(float x, float y, float z) { PushN(x); PushN(y); PushN(z); }
   void PushN(const TEveVectorF &v)      { PushN(v.fX); PushN(v.fY); PushN(v.fZ); }

   void PushI(int i)                { fIndexBuffer.push_back(i); }
   void PushI(int i, int j, int k)  { PushI(i); PushI(j); PushI(k); }

   int GetBinarySize()
   {
      return fVertexBuffer.size() * sizeof(float) +
             fNormalBuffer.size() * sizeof(float) +
             fIndexBuffer.size()  * sizeof(int);
   }

   int Write(char* msg)
   {
      // XXXX Where do we make sure the buffer is large enough?
      //std::string fh = fHeader.dump();
      //memcpy(msg, fh.c_str(), fh.size());
      //int off = int(ceil(fh.size()/4.0))*4;

      int off = 0;

      if ( ! fVertexBuffer.empty())
      {
         int binsize = fVertexBuffer.size()*sizeof(float);
         memcpy(msg+off, &fVertexBuffer[0], binsize);
         off += binsize;
      }
      if ( ! fNormalBuffer.empty())
      {
         int binsize = fNormalBuffer.size()*sizeof(float);
         memcpy(msg+off, &fNormalBuffer[0], binsize);
         off += binsize;
      }
      if ( ! fIndexBuffer.empty())
      {
         int binsize = fIndexBuffer.size()*sizeof(float);
         memcpy(msg+off, &fIndexBuffer[0], binsize);
         off += binsize;
      }
      return off;
   }

   void Dump() {
      printf("RederData dump %d\n", (int)fVertexBuffer.size());
      int cnt = 0;
      for (auto it = fVertexBuffer.begin(); it !=fVertexBuffer.end(); ++it )
      {
         printf("%d %f", cnt++, *it);
      }
   }

   std::string         fRnrFunc;;
   std::vector<float>  fVertexBuffer;
   std::vector<float>  fNormalBuffer;
   std::vector<int>    fIndexBuffer;

   ClassDef(RenderData, 1);
};


//------------------------------------------------------------------------------

class TEveElement
{
   friend class TEveManager;
   friend class TEveScene;

   TEveElement& operator=(const TEveElement&); // Not implemented

public:
   typedef std::list<TEveElement*>              List_t;
   typedef List_t::iterator                     List_i;
   typedef List_t::const_iterator               List_ci;

   typedef std::set<TEveElement*>               Set_t;
   typedef Set_t::iterator                      Set_i;
   typedef Set_t::const_iterator                Set_ci;

private:
   ElementId_t      fElementId = 0;        // Unique ID of an element.

protected:
   TEveElement     *fMother    = 0;
   TEveScene       *fScene     = 0;

   ElementId_t get_mother_id() const;
   ElementId_t get_scene_id()  const;

   void assign_element_id_recurisvely();
   void assign_scene_recursively(TEveScene* s);

protected:
   List_t           fParents;              //  List of parents.
   List_t           fChildren;             //  List of children.
   TEveCompound    *fCompound;             //  Compound this object belongs to.
   TEveElement     *fVizModel;             //! Element used as model from VizDB.
   TString          fVizTag;               //  Tag used to query VizDB for model element.

   Int_t            fNumChildren;          //!
   Int_t            fParentIgnoreCnt;      //! Counter for parents that are ignored in ref-counting.
   Int_t            fDenyDestroy;          //! Deny-destroy count.
   Bool_t           fDestroyOnZeroRefCnt;  //  Auto-destruct when ref-count reaches zero.

   Bool_t           fRnrSelf;                 //  Render this element.
   Bool_t           fRnrChildren;             //  Render children of this element.
   Bool_t           fCanEditMainColor;        //  Allow editing of main color.
   Bool_t           fCanEditMainTransparency; //  Allow editing of main transparency.
   Bool_t           fCanEditMainTrans;        //  Allow editing of main transformation.

   Char_t           fMainTransparency;     //  Main-transparency variable.
   Color_t         *fMainColorPtr;         //  Pointer to main-color variable.
   TEveTrans       *fMainTrans;            //  Pointer to main transformation matrix.

   TRef             fSource;               //  External object that is represented by this element.
   void            *fUserData = 0;         //! Externally assigned and controlled user data.
   std::unique_ptr<RenderData> fRenderData;//! Vertex / normal / triangle index information for rendering.

   virtual void PreDeleteElement();
   virtual void RemoveElementsInternal();
   virtual void AnnihilateRecursively();

   static const char* ToString(Bool_t b);

public:
   TEveElement();
   TEveElement(Color_t& main_color);
   TEveElement(const TEveElement& e);
   virtual ~TEveElement();

   ElementId_t GetElementId() const { return fElementId; }

   virtual TEveElement* CloneElement() const;
   virtual TEveElement* CloneElementRecurse(Int_t level=0) const;
   virtual void         CloneChildrenRecurse(TEveElement* dest, Int_t level=0) const;

   virtual const char* GetElementName()  const;
   virtual const char* GetElementTitle() const;
   virtual TString     GetHighlightTooltip() { return TString(GetElementTitle()); }
   virtual void SetElementName (const char* name);
   virtual void SetElementTitle(const char* title);
   virtual void SetElementNameTitle(const char* name, const char* title);
   virtual void NameTitleChanged();

   const TString& GetVizTag() const             { return fVizTag; }
   void           SetVizTag(const TString& tag) { fVizTag = tag;  }

   TEveElement*   GetVizModel() const           { return fVizModel; }
   void           SetVizModel(TEveElement* model);
   Bool_t         FindVizModel();

   Bool_t         ApplyVizTag(const TString& tag, const TString& fallback_tag="");

   virtual void PropagateVizParamsToProjecteds();
   virtual void PropagateVizParamsToElements(TEveElement* el=0);
   virtual void CopyVizParams(const TEveElement* el);
   virtual void CopyVizParamsFromDB();
   void         SaveVizParams (std::ostream& out, const TString& tag, const TString& var);
   virtual void WriteVizParams(std::ostream& out, const TString& var);

   TEveElement*  GetMaster();
   TEveCompound* GetCompound()                { return fCompound; }
   void          SetCompound(TEveCompound* c) { fCompound = c;    }

   TEveScene*   GetScene()  { return fScene;  }
   TEveElement* GetMother() { return fMother; }

   virtual void AddParent(TEveElement* el);
   virtual void RemoveParent(TEveElement* el);
   virtual void CheckReferenceCount(const TEveException& eh="TEveElement::CheckReferenceCount ");
   virtual void CollectSceneParents(List_t& scenes);
   virtual void CollectSceneParentsFromChildren(List_t& scenes,
                                                TEveElement* parent);

   List_i  BeginParents()        { return  fParents.begin();  }
   List_i  EndParents()          { return  fParents.end();    }
   List_ci BeginParents()  const { return  fParents.begin();  }
   List_ci EndParents()    const { return  fParents.end();    }
   Int_t   NumParents()    const { return  fParents.size();   }
   Bool_t  HasParents()    const { return !fParents.empty();  }

   const List_t& RefChildren() const { return  fChildren;     }
   List_i  BeginChildren()       { return  fChildren.begin(); }
   List_i  EndChildren()         { return  fChildren.end();   }
   List_ci BeginChildren() const { return  fChildren.begin(); }
   List_ci EndChildren()   const { return  fChildren.end();   }
   Int_t   NumChildren()   const { return  fNumChildren;      }
   Bool_t  HasChildren()   const { return  fNumChildren != 0; }

   Bool_t       HasChild(TEveElement* el);
   TEveElement* FindChild(const TString& name, const TClass* cls=0);
   TEveElement* FindChild(TPRegexp& regexp, const TClass* cls=0);
   Int_t        FindChildren(List_t& matches, const TString&  name, const TClass* cls=0);
   Int_t        FindChildren(List_t& matches, TPRegexp& regexp, const TClass* cls=0);
   TEveElement* FirstChild() const;
   TEveElement* LastChild () const;

   void EnableListElements (Bool_t rnr_self=kTRUE,  Bool_t rnr_children=kTRUE);  // *MENU*
   void DisableListElements(Bool_t rnr_self=kFALSE, Bool_t rnr_children=kFALSE); // *MENU*

   Bool_t GetDestroyOnZeroRefCnt() const;
   void   SetDestroyOnZeroRefCnt(Bool_t d);

   Int_t  GetDenyDestroy() const;
   void   IncDenyDestroy();
   void   DecDenyDestroy();

   Int_t  GetParentIgnoreCnt() const;
   void   IncParentIgnoreCnt();
   void   DecParentIgnoreCnt();

   virtual TObject* GetObject      (const TEveException& eh) const;
   virtual TObject* GetEditorObject(const TEveException& eh) const { return GetObject(eh); }
   virtual TObject* GetRenderObject(const TEveException& eh) const { return GetObject(eh); }

   // --------------------------------

   virtual void ExportToCINT(char* var_name); // *MENU*

   void    DumpSourceObject() const;                       // *MENU*
   void    PrintSourceObject() const;                      // *MENU*
   void    ExportSourceObjectToCINT(char* var_name) const; // *MENU*

   virtual Bool_t AcceptElement(TEveElement* el);

   virtual void AddElement(TEveElement* el);
   virtual void RemoveElement(TEveElement* el);
   virtual void RemoveElementLocal(TEveElement* el);
   virtual void RemoveElements();
   virtual void RemoveElementsLocal();

   virtual void AnnihilateElements();
   virtual void Annihilate();

   virtual void ProjectChild(TEveElement* el, Bool_t same_depth=kTRUE);
   virtual void ProjectAllChildren(Bool_t same_depth=kTRUE);

   virtual void Destroy();                      // *MENU*
   virtual void DestroyOrWarn();
   virtual void DestroyElements();              // *MENU*

   virtual Bool_t HandleElementPaste(TEveElement* el);
   virtual void   ElementChanged(Bool_t update_scenes=kTRUE, Bool_t redraw=kFALSE);

   virtual Bool_t CanEditElement() const { return kTRUE; }
   virtual Bool_t SingleRnrState() const { return kFALSE; }
   virtual Bool_t GetRnrSelf()     const { return fRnrSelf; }
   virtual Bool_t GetRnrChildren() const { return fRnrChildren; }
   virtual Bool_t GetRnrState()    const { return fRnrSelf && fRnrChildren; }
   virtual Bool_t GetRnrAnything() const { return fRnrSelf || (fRnrChildren && HasChildren()); }
   virtual Bool_t SetRnrSelf(Bool_t rnr);
   virtual Bool_t SetRnrChildren(Bool_t rnr);
   virtual Bool_t SetRnrSelfChildren(Bool_t rnr_self, Bool_t rnr_children);
   virtual Bool_t SetRnrState(Bool_t rnr);
   virtual void   PropagateRnrStateToProjecteds();

   virtual Bool_t CanEditMainColor() const   { return fCanEditMainColor; }
   void           SetEditMainColor(Bool_t x) { fCanEditMainColor = x; }
   Color_t* GetMainColorPtr()        const   { return fMainColorPtr; }
   void     SetMainColorPtr(Color_t* color)  { fMainColorPtr = color; }

   virtual Bool_t  HasMainColor() const { return fMainColorPtr != 0; }
   virtual Color_t GetMainColor() const { return fMainColorPtr ? *fMainColorPtr : 0; }
   virtual void    SetMainColor(Color_t color);
   void            SetMainColorPixel(Pixel_t pixel);
   void            SetMainColorRGB(UChar_t r, UChar_t g, UChar_t b);
   void            SetMainColorRGB(Float_t r, Float_t g, Float_t b);
   virtual void    PropagateMainColorToProjecteds(Color_t color, Color_t old_color);

   virtual Bool_t  CanEditMainTransparency() const   { return fCanEditMainTransparency; }
   void            SetEditMainTransparency(Bool_t x) { fCanEditMainTransparency = x; }
   virtual Char_t  GetMainTransparency()     const { return fMainTransparency; }
   virtual void    SetMainTransparency(Char_t t);
   void            SetMainAlpha(Float_t alpha);
   virtual void    PropagateMainTransparencyToProjecteds(Char_t t, Char_t old_t);

   virtual Bool_t     CanEditMainTrans() const { return fCanEditMainTrans; }
   virtual Bool_t     HasMainTrans()     const { return fMainTrans != 0;   }
   virtual TEveTrans* PtrMainTrans(Bool_t create=kTRUE);
   virtual TEveTrans& RefMainTrans();
   virtual void       InitMainTrans(Bool_t can_edit=kTRUE);
   virtual void       DestroyMainTrans();

   virtual void SetTransMatrix(Double_t* carr);
   virtual void SetTransMatrix(const TGeoMatrix& mat);

   virtual Int_t WriteCoreJson(nlohmann::json& cj, Int_t rnr_offset);
   virtual void  BuildRenderData() {}
   
   TRef&    GetSource()                 { return fSource; }
   TObject* GetSourceObject()     const { return fSource.GetObject(); }
   void     SetSourceObject(TObject* o) { fSource = o; }
   /*
     void DumpSourceObject();    // *MENU*
     void InspectSourceObject(); // *MENU*
   */

   void* GetUserData() const { return fUserData; }
   void  SetUserData(void* ud) { fUserData = ud; }

   RenderData* GetRenderData() const { return fRenderData.get(); }


   // Selection state and management
   //--------------------------------

protected:
   Bool_t  fPickable;
   Bool_t  fSelected;             //!
   Bool_t  fHighlighted;          //!
   Short_t fImpliedSelected;      //!
   Short_t fImpliedHighlighted;   //!

   enum ECompoundSelectionColorBits
   {
      kCSCBImplySelectAllChildren           = BIT(0), // compound will select all children
      kCSCBTakeAnyParentAsMaster            = BIT(1), // element will take any compound parent as master
      kCSCBApplyMainColorToAllChildren      = BIT(2), // compound will apply color change to all children
      kCSCBApplyMainColorToMatchingChildren = BIT(3), // compound will apply color change to all children with matching color
      kCSCBApplyMainTransparencyToAllChildren      = BIT(4), // compound will apply transparency change to all children
      kCSCBApplyMainTransparencyToMatchingChildren = BIT(5)  // compound will apply transparency change to all children with matching color
   };

   enum EDestruct
   {
      kNone,
      kStandard,
      kAnnihilate
   };

   UChar_t fCSCBits;

public:
   typedef void (TEveElement::* Select_foo)      (Bool_t);
   typedef void (TEveElement::* ImplySelect_foo) ();

   Bool_t IsPickable()    const { return fPickable; }
   void   SetPickable(Bool_t p) { fPickable = p; }
   void   SetPickableRecursively(Bool_t p);

   virtual TEveElement* ForwardSelection();
   virtual TEveElement* ForwardEdit();

   virtual void SelectElement(Bool_t state);
   virtual void IncImpliedSelected();
   virtual void DecImpliedSelected();
   virtual void UnSelected();

   virtual void HighlightElement(Bool_t state);
   virtual void IncImpliedHighlighted();
   virtual void DecImpliedHighlighted();
   virtual void UnHighlighted();

   virtual void FillImpliedSelectedSet(Set_t& impSelSet);

   virtual UChar_t GetSelectedLevel() const;

   void   RecheckImpliedSelections();

   void   SetCSCBits(UChar_t f)   { fCSCBits |=  f; }
   void   ResetCSCBits(UChar_t f) { fCSCBits &= ~f; }
   Bool_t TestCSCBits(UChar_t f) const { return (fCSCBits & f) != 0; }

   void   ResetAllCSCBits()                     { fCSCBits  =  0; }
   void   CSCImplySelectAllChildren()           { fCSCBits |= kCSCBImplySelectAllChildren; }
   void   CSCTakeAnyParentAsMaster()            { fCSCBits |= kCSCBTakeAnyParentAsMaster;  }
   void   CSCApplyMainColorToAllChildren()      { fCSCBits |= kCSCBApplyMainColorToAllChildren; }
   void   CSCApplyMainColorToMatchingChildren() { fCSCBits |= kCSCBApplyMainColorToMatchingChildren; }
   void   CSCApplyMainTransparencyToAllChildren()      { fCSCBits |= kCSCBApplyMainTransparencyToAllChildren; }
   void   CSCApplyMainTransparencyToMatchingChildren() { fCSCBits |= kCSCBApplyMainTransparencyToMatchingChildren; }


   // Change-stamping and change bits
   //---------------------------------

   enum EChangeBits
   {
      kCBColorSelection =  BIT(0), // Main color or select/hilite state changed.
      kCBTransBBox      =  BIT(1), // Transformation matrix or bounding-box changed.
      kCBObjProps       =  BIT(2), // Object changed, requires dropping its display-lists.
      kCBVisibility     =  BIT(3)  // Rendering of self/children changed.
      // kCBElementAdded   = BIT(), // Element was added to a new parent.
      // kCBElementRemoved = BIT()  // Element was removed from a parent.

      // Deletions are handled in a special way in TEveManager::PreDeleteElement().
   };

protected:
   UChar_t      fChangeBits;  //!
   Char_t       fDestructing; //!

public:
   void StampColorSelection() { AddStamp(kCBColorSelection); }
   void StampTransBBox()      { AddStamp(kCBTransBBox); }
   void StampObjProps()       { AddStamp(kCBObjProps); }
   void StampVisibility()     { AddStamp(kCBVisibility); }
   // void StampElementAdded()   { AddStamp(kCBElementAdded); }
   // void StampElementRemoved() { AddStamp(kCBElementRemoved); }
   virtual void AddStamp(UChar_t bits);
   virtual void ClearStamps() { fChangeBits = 0; }

   UChar_t GetChangeBits() const { return fChangeBits; }


   // Menu entries for VizDB communication (here so they are last in the menu).

   void VizDB_Apply(const char* tag);           // *MENU*
   void VizDB_Reapply();                        // *MENU*
   void VizDB_UpdateModel(Bool_t update=kTRUE); // *MENU*
   void VizDB_Insert(const char* tag, Bool_t replace=kTRUE, Bool_t update=kTRUE); // *MENU*

   ClassDef(TEveElement, 0); // Base class for TEveUtil visualization elements, providing hierarchy management, rendering control and list-tree item management.
};


/******************************************************************************/
// TEveElementObjectPtr
/******************************************************************************/

class TEveElementObjectPtr : public TEveElement,
                             public TObject
{
   TEveElementObjectPtr& operator=(const TEveElementObjectPtr&); // Not implemented

protected:
   TObject* fObject;     // External object holding the visual data.
   Bool_t   fOwnObject;  // Is object owned / should be deleted on destruction.

public:
   TEveElementObjectPtr(TObject* obj, Bool_t own=kTRUE);
   TEveElementObjectPtr(TObject* obj, Color_t& mainColor, Bool_t own=kTRUE);
   TEveElementObjectPtr(const TEveElementObjectPtr& e);
   virtual ~TEveElementObjectPtr();

   virtual TEveElementObjectPtr* CloneElement() const;

   virtual TObject* GetObject(const TEveException& eh="TEveElementObjectPtr::GetObject ") const;
   virtual void     ExportToCINT(char* var_name);

   Bool_t GetOwnObject() const   { return fOwnObject; }
   void   SetOwnObject(Bool_t o) { fOwnObject = o; }

   ClassDef(TEveElementObjectPtr, 0); // TEveElement with external TObject as a holder of visualization data.
};


/******************************************************************************/
// TEveElementList
/******************************************************************************/

class TEveElementList : public TEveElement,
                        public TNamed,
                        public TEveProjectable
{
private:
   TEveElementList& operator=(const TEveElementList&); // Not implemented

protected:
   Color_t   fColor;          // Color of the object.
   TClass   *fChildClass;     // Class of acceptable children, others are rejected.

public:
   TEveElementList(const char* n="TEveElementList", const char* t="",
                   Bool_t doColor=kFALSE, Bool_t doTransparency=kFALSE);
   TEveElementList(const TEveElementList& e);
   virtual ~TEveElementList() {}

   virtual TObject* GetObject(const TEveException& /*eh*/="TEveElementList::GetObject ") const
   { const TObject* obj = this; return const_cast<TObject*>(obj); }

   virtual TEveElementList* CloneElement() const;

   virtual const char* GetElementName()  const { return GetName();  }
   virtual const char* GetElementTitle() const { return GetTitle(); }

   virtual void SetElementName (const char* name)
   { TNamed::SetName(name); NameTitleChanged(); }

   virtual void SetElementTitle(const char* title)
   { TNamed::SetTitle(title); NameTitleChanged(); }

   virtual void SetElementNameTitle(const char* name, const char* title)
   { TNamed::SetNameTitle(name, title); NameTitleChanged(); }

   TClass* GetChildClass() const { return fChildClass; }
   void    SetChildClass(TClass* c) { fChildClass = c; }

   // Element
   Bool_t  AcceptElement(TEveElement* el); // override;

   // Projectable
   TClass* ProjectedClass(const TEveProjection* p) const; // override;

   ClassDef(TEveElementList, 0); // List of TEveElement objects with a possibility to limit the class of accepted elements.
};


/******************************************************************************/
// TEveElementListProjected
/******************************************************************************/

class TEveElementListProjected : public TEveElementList,
                                 public TEveProjected
{
private:
   TEveElementListProjected(const TEveElementListProjected&);            // Not implemented
   TEveElementListProjected& operator=(const TEveElementListProjected&); // Not implemented

public:
   TEveElementListProjected();
   virtual ~TEveElementListProjected() {}

   virtual void UpdateProjection();
   virtual TEveElement* GetProjectedAsElement() { return this; }

   ClassDef(TEveElementListProjected, 0); // Projected TEveElementList.
};

}}

#endif
