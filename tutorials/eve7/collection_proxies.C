/// \file
/// \ingroup tutorial_eve7
///  This example display collection of ??? in web browser
///
/// \macro_code
///

#include <ROOT/REvePointSet.hxx>
#include <ROOT/REveScene.hxx>
#include <ROOT/REveJetCone.hxx>
#include <ROOT/REveGeoShape.hxx>
#include "ROOT/REveDataClasses.hxx"
#include "ROOT/REveDataCollectionManager.hxx"
#include "ROOT/REveDataProxyBuilderBase.hxx"
#include "ROOT/REveDataSimpleProxyBuilder.hxx"
#include "ROOT/REveDataSimpleProxyBuilderTemplate.hxx"
#include <ROOT/REveTrack.hxx>
#include <ROOT/REveTrackPropagator.hxx>
#include <ROOT/REveViewer.hxx>
#include <ROOT/REveProjectionBases.hxx>
#include <ROOT/REveProjectionManager.hxx>
#include "ROOT/REveManager.hxx"

#include "TParticle.h"
#include "TRandom.h"
#include "TGeoTube.h"
Color_t trackColor = kGreen + 2;
Color_t jetColor = kYellow;

namespace REX = ROOT::Experimental;

//==============================================================================
//============== EMULATE FRAMEWORK CLASSES =====================================
//==============================================================================
// a demo class, can be provided from experiment framework
class XYJet : public TParticle
{
private:
   float m_etaSize;
   float m_phiSize;

public:
   float GetEtaSize() const { return m_etaSize; }
   float GetPhiSize() const { return m_phiSize; }
   void SetEtaSize(float iEtaSize) { m_etaSize = iEtaSize; }
   void SetPhiSize(float iPhiSize) { m_phiSize = iPhiSize; }
   XYJet(Int_t pdg, Int_t status, Int_t mother1, Int_t mother2, Int_t daughter1, Int_t daughter2, Double_t px, Double_t py, Double_t pz, Double_t etot):
      TParticle(pdg, status, mother1, mother2, daughter1, daughter2, px, py, pz, etot,  0, 0, 0, 0) {}

   ClassDef(XYJet, 1);
};
//==============================================================================
//============ TABLE HELPER CLASSES ============================================
//==============================================================================
struct TableEntry {
   std::string    fName;
   std::string    fExpression;
   int            fPrecision;
   REX::REveDataColumn::FieldType_e fType;

   TableEntry() : fName("unknown"), fPrecision(2), fType(REX::REveDataColumn::FT_Double) {}
   void Print() const {
      printf("TableEntry\n");
      printf("name: %s expression: %s\n", fName.c_str(), fExpression.c_str());
   }
};


class TableHandle
{
public:
   typedef std::vector<TableEntry> TableEntries;
   typedef std::map<std::string, TableEntries> TableSpecs;

   TableHandle&
   column(const char *name, int precision, const char *expression)
   {
      TableEntry columnEntry;
      columnEntry.fName = name;
      columnEntry.fPrecision = precision;
      columnEntry.fExpression = expression;

      m_specs[m_name].push_back(columnEntry);
      return *this;
   }

   TableHandle &column(const char *label, int precision)
   {
      return column(label, precision, label);
   }

   TableHandle(std::string collectionName, TableSpecs &specs)
      :m_name(collectionName), m_specs(specs)
   {
      m_specs[collectionName].clear();
   }

private:
   std::string  m_name;
   TableSpecs  &m_specs;
};

//==============================================================================
//============ PROXY BUILDERS  ================================================
//==============================================================================
class XYJetProxyBuilder: public REX::REveDataSimpleProxyBuilderTemplate<XYJet>
{
   using REveDataSimpleProxyBuilderTemplate<XYJet>::Build;
   virtual void Build(const XYJet& dj, REX::REveElement* iItemHolder, const REX::REveViewContext* context)
   {
      auto jet = new REX::REveJetCone();
      jet->SetCylinder(2*context->GetMaxR(), context->GetMaxZ());
      jet->AddEllipticCone(dj.Eta(), dj.GetPolarPhi(), dj.GetEtaSize(), dj.GetPhiSize());
      SetupAddElement(jet, iItemHolder);
      jet->SetElementName(Form("element %s", iItemHolder->GetElementName()));
   }
};

class TrackProxyBuilder : public REX::REveDataSimpleProxyBuilderTemplate<TParticle>
{   
   using REveDataSimpleProxyBuilderTemplate<TParticle>::Build;
   virtual void Build(const TParticle& p, REX::REveElement* iItemHolder, const REX::REveViewContext* context)
   {
      const TParticle* x = &p;
      auto track = new REX::REveTrack((TParticle*)(x), 1, context->GetPropagator());
      track->MakeTrack();
      SetupAddElement(track, iItemHolder, false);
      iItemHolder->AddElement(track);
      track->SetElementName(Form("element %s", iItemHolder->GetElementName()));
   }
};

class TableProxyBuilder : public REX::REveDataProxyBuilderBase
{
private:
   TableHandle::TableEntries m_specs;
   REX::REveDataTable* m_table;
   
public:
   TableProxyBuilder() : REX::REveDataProxyBuilderBase("Table"), m_table(0) {}
   virtual bool WillHandleInteraction() const { return true; }

   using REX::REveDataProxyBuilderBase::ModelChanges;
   virtual void ModelChanges(const REX::REveDataCollection::Ids_t&, REX::REveDataProxyBuilderBase::Product* p)
   {
      m_table->StampObjProps();
   }

   using REX::REveDataProxyBuilderBase::Build;
   virtual void Build(const REX::REveDataCollection* collection, REX::REveElementList* product, const REX::REveViewContext* context)
   {
      if (!GetHaveAWindow())
         return;

      auto table = new REX::REveDataTable("testTable");
      table->SetCollection(collection);

      for (const TableEntry& spec : m_specs) {
         auto c = new REX::REveDataColumn(spec.fName.c_str());
         table->AddElement(c);
         std::string exp  = "i." + spec.fExpression + "()";
         c->SetExpressionAndType(exp.c_str(), spec.fType);
         c->SetPrecision(spec.fPrecision);
      }

      product->AddElement(table);
      m_table = table;
   }

   void SetTableEntries(TableHandle::TableEntries& iSpecs)
   {
       for (TableEntry& spec : iSpecs) {
          m_specs.push_back(spec);
       }

   }
};

//==============================================================================
//==============================================================================
// ================= XY MANGER  ================================================
//==============================================================================
//==============================================================================
class XYManager
{
private:
   std::vector <REX::REveScene*> m_scenes;
   REX::REveViewContext* m_viewContext;

   REX::REveProjectionManager* m_mngRhoZ;

   std::vector<REX::REveDataProxyBuilderBase*> m_builders;
   //   std::vector<REX::REveDataCollection*> m_collections;
   REX::REveScene* m_collections;

   TableHandle::TableSpecs  m_tableFormats;

public:
   XYManager() {
      createScenesAndViews();

      // table specs
      table("XYTracks").
         column("pt", 1, "Pt").
         column("eta", 3, "Eta").
         column("phi", 3, "Phi");

      table("XYJets").
         column("eta", 1, "Eta").
         column("phi", 1, "Phi").
         column("etasize", 2, "GetEtaSize").
         column("phisize", 2, "GetPhiSize");


      //view context
      float r = 300;
      float z = 600;
      auto prop = new REX::REveTrackPropagator();
      prop->SetMagFieldObj(new REX::REveMagFieldDuo(350, -3.5, 2.0));
      prop->SetMaxR(r);
      prop->SetMaxZ(z);
      prop->SetMaxOrbs(6);

      m_viewContext = new REX::REveViewContext();
      m_viewContext->SetBarrel(r, z);
      m_viewContext->SetTrackPropagator(prop);
   }

   void createScenesAndViews()
   {
      // collections
      m_collections = REX::gEve->SpawnNewScene("Collections","Collections");

      // 3D
      m_scenes.push_back(REX::gEve->GetEventScene());

      // RhoZ
      if (1) {
         auto rhoZEventScene = REX::gEve->SpawnNewScene("RhoZ Scene","Projected");
         m_mngRhoZ = new REX::REveProjectionManager(REX::REveProjection::kPT_RhoZ);
         m_mngRhoZ->SetImportEmpty(true);
         auto rhoZView = REX::gEve->SpawnNewViewer("RhoZ View", "");
         rhoZView->AddScene(rhoZEventScene);
         m_scenes.push_back(rhoZEventScene);
      }

      // Table
      auto tableScene  = REX::gEve->SpawnNewScene("Tables", "Tables");
      auto tableView = REX::gEve->SpawnNewViewer("Table", "Table View");
      tableView->AddScene(tableScene);
      m_scenes.push_back(tableScene);

   }

   // this should be handeled with framefor plugins
   REX::REveDataProxyBuilderBase*  makeGLBuilderForType(TClass* c)
   {
      std::string cn = c->GetName();
      if (cn == "XYJet") {
         return new XYJetProxyBuilder();
      }
      else
      {
         return new TrackProxyBuilder();
      }
   }

   void addCollection(REX::REveDataCollection* collection)
   {
      // GL view types
      auto glBuilder = makeGLBuilderForType(collection->GetItemClass());
      glBuilder->SetCollection(collection);
      glBuilder->SetHaveAWindow(true);
      REX::REveElementList* product = glBuilder->CreateProduct(m_viewContext);
      for (REX::REveScene* scene : m_scenes) {
         if (strncmp(scene->GetTitle(), "Table", 5) == 0) continue;
         if (!strncmp(scene->GetTitle(), "Projected", 8)) {
            m_mngRhoZ->ImportElements(product, scene);
         }
         else {
            scene->AddElement(product);
         }
      }
      m_builders.push_back(glBuilder);
      glBuilder->Build();

      // Table view types      {
      bool showTable = !m_collections->HasChildren();
      auto tableBuilder = new TableProxyBuilder();
      tableBuilder->SetCollection(collection);
      tableBuilder->SetHaveAWindow(showTable);
      tableBuilder->SetTableEntries(m_tableFormats[collection->GetName()]);

         REX::REveElementList* tablep = tableBuilder->CreateProduct(m_viewContext);
         for (REX::REveScene* scene : m_scenes) {
            if (strncmp(scene->GetTitle(), "Table", 5) == 0) {
               scene->AddElement(tablep);
               tableBuilder->Build(collection, tablep, m_viewContext );
            }
         }

      m_builders.push_back(tableBuilder);
      m_collections->AddElement(collection);

      collection->SetHandlerFunc([&] (REX::REveDataCollection* collection) { this->CollectionChanged( collection ); });
      collection->SetHandlerFuncIds([&] (REX::REveDataCollection* collection, const REX::REveDataCollection::Ids_t& ids) { this->ModelChanged( collection, ids ); });
   }

   TableHandle table(const char *collectionName){
      TableHandle handle(collectionName, m_tableFormats);
      return handle;
   }


   void CollectionChanged(REX::REveDataCollection* collection) {
      printf("collection changes %s \n", collection->GetElementName());
   }

   void ModelChanged(REX::REveDataCollection* collection, const REX::REveDataCollection::Ids_t& ids) {
      for (auto proxy : m_builders) {
         if (proxy->Collection() == collection) {
            // printf("XXXXX Model changes check proxy %s: \n", proxy->Type().c_str());
            proxy->ModelChanges(ids);
         }
      }
   }
};



//==============================================================================
//==============================================================================
// ================= EMULATE FRAMEWORK DATA  ===================================
//==============================================================================
//==============================================================================
REX::REveDataCollection* makeTrackCollection(const char* name, int N)
{
   REX::REveDataCollection* collection = new REX::REveDataCollection(name);
   collection->SetItemClass(TParticle::Class());
   //collection->SetMainColorRGB((UChar_t)100, 0, 0);
   collection->SetMainColorPtr(&trackColor);
   TRandom &r = * gRandom;
   r.SetSeed(0);

   for (int i = 1; i <= N; ++i)
   {
      double pt  = r.Uniform(0.5, 10);
      double eta = r.Uniform(-2.55, 2.55);
      double phi = r.Uniform(0, TMath::TwoPi());

      double px = pt * std::cos(phi);
      double py = pt * std::sin(phi);
      double pz = pt * (1. / (std::tan(2*std::atan(std::exp(-eta)))));

      // printf("%2d: pt=%.2f, eta=%.2f, phi=%.2f\n", i, pt, eta, phi);

      auto particle = new TParticle(0, 0, 0, 0, 0, 0,
                    px, py, pz, std::sqrt(px*px + py*py + pz*pz + 80*80),
                    0, 0, 0, 0 );

      int pdg = 11 * (r.Integer(2) > 0 ? 1 : -1);
      particle->SetPdgCode(pdg);


      TString pname; pname.Form("item %2d", i);
      collection->AddItem(particle, pname.Data(), "");
      collection->GetDataItem(i-1)->SetMainColorPtr(collection->GetMainColorPtr());
   }

   return collection;
}

REX::REveDataCollection* makeJetCollection(const char* name, int N)
{
   REX::REveDataCollection* collection = new REX::REveDataCollection(name);
   collection->SetItemClass(XYJet::Class());
   collection->SetMainColorPtr(&jetColor);


   TRandom &r = * gRandom;
   r.SetSeed(0);

   for (int i = 1; i <= N; ++i)
   {
      double pt  = r.Uniform(0.5, 10);
      double eta = r.Uniform(-2.55, 2.55);
      double phi = r.Uniform(0, TMath::TwoPi());

      double px = pt * std::cos(phi);
      double py = pt * std::sin(phi);
      double pz = pt * (1. / (std::tan(2*std::atan(std::exp(-eta)))));

      auto jet = new XYJet(0, 0, 0, 0, 0, 0, px, py, pz, std::sqrt(px*px + py*py + pz*pz + 80*80));
      jet->SetEtaSize(r.Uniform(0.02, 0.2));
      jet->SetPhiSize(r.Uniform(0.01, 0.3));

      TString pname; pname.Form("item %2d", i);
      collection->AddItem(jet, pname.Data(), "");
      collection->GetDataItem(i-1)->SetMainColorPtr(collection->GetMainColorPtr());
   }

   return collection;
}

//==============================================================================
//==============================================================================


void collection_proxies()
{
   REX::REveManager::Create();

   auto xyManager = new XYManager();

   auto trackCollection = makeTrackCollection("XYTracks", 10);
   trackCollection->SetFilterExpr("i.Pt() > 0.1 && std::abs(i.Eta()) < 1");
   xyManager->addCollection(trackCollection);

   if (1) {
   auto jetCollection = makeJetCollection("XYJets", 4);
   xyManager->addCollection(jetCollection);
   }

   REX::gEve->Show();
}
